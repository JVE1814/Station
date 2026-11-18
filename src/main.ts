import {
  ACESFilmicToneMapping, Group, Matrix4, PCFShadowMap, Quaternion, RepeatWrapping, Scene, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three';
import { Atmosphere, skyReflection } from './atmosphere';
import type { Weather } from './atmosphere';
import { Cameras } from './cameras';
import type { View } from './cameras';
import { loadNetworkRoute, readWorldAsset } from './network';
import type { NetworkRoute } from './network';
import { NetworkOverview } from './network-overview';
import type { OverviewRoute } from './network-overview';
import routeCatalog from '../data/route-catalog.json';
import { Rail } from './rail';
import { createCab, createTrain, ROLLING_STOCK_SHADOW_LAYER } from './rolling-stock';
import { auditTrackbed, createScenery } from './scenery';
import { Service } from './service';
import { SceneryStream } from './streaming';
import { Traffic } from './traffic';
import { groundHeight, timetableSeconds } from './world-data';
import type { Station, WorldData } from './world-data';
import './style.css';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing simulator control ${id}`);
  return item as T;
}

async function run(): Promise<void> {
  const options = new URLSearchParams(location.search);
  const ref = options.get('line');
  const networkData = ref && ['F4', 'F5', 'F6'].includes(ref) ? await loadNetworkRoute(ref) : null;
  const network = networkData?.line;
  const pair = network ? null : await readWorldAsset<WorldData>('data/service.json');
  if (!network && !pair) throw new Error('The offline service file could not be loaded.');
  const data = network ? { ...network, service: network.ref } : pair!;
  const rail = new Rail(data.rail);
  const service = new Service(data, rail);
  const traffic = network?.traffic?.length ? new Traffic(data, rail, service, network.traffic) : null;
  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  // Tile transforms are set when built. Moving stock, lighting and map labels update their own matrices.
  scene.matrixWorldAutoUpdate = false;
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const world = element('world');
  world.append(renderer.domElement);

  world.dataset.stage = 'lighting';
  const dayReflection = skyReflection(false);
  const nightReflection = skyReflection(true);
  scene.environment = dayReflection;
  scene.environmentIntensity = 0.55;

  world.dataset.stage = 'scenery';
  const textures = new TextureLoader();
  const loadMap = async (name: string) => {
    const texture = await textures.loadAsync(`${import.meta.env.BASE_URL}assets/${name}.webp`);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  const [grass, ballast, spruce, siding, roofing, dashboard, steel] = await Promise.all([
    'grass', 'ballast', 'spruce', 'siding', 'roofing', 'dashboard', 'steel',
  ].map(loadMap));
  const maps = { grass, ballast, spruce, siding, roofing };
  let dirty = true;
  const sceneryChanged = () => { dirty = true; };
  const sceneryError = (error: unknown) => {
    element('notice').textContent = 'A scenery tile could not be loaded.';
    console.error(error);
  };
  const activeStream = network
    ? new SceneryStream(network.tiles, maps, rail, data.spans, sceneryError, sceneryChanged) : undefined;
  const scenery = activeStream ?? createScenery(pair!, rail, maps);
  if (activeStream) await activeStream.ready(data.stations[0].stopDistance);
  const otherRoutes = networkData?.routes.filter(route => route.ref !== data.service) ?? [];
  const mapStreams = new Map<NetworkRoute, SceneryStream>();
  let mapStream: SceneryStream | undefined;
  const heightAt = activeStream ? (x: number, z: number) => activeStream.heightAt(x, z) ?? mapStream?.heightAt(x, z)
    : (x: number, z: number) => groundHeight(pair!.terrain, x, -z);
  scene.add(scenery.group);
  const audit = options.get('audit') === 'trackbed';
  const profile = audit && options.get('profile') === 'phases';
  const markPhase = (phase: string) => {
    if (!profile) return;
    performance.mark(phase);
    performance.clearMarks(phase);
  };
  if (audit) {
    const gl = renderer.getContext();
    const driver = gl.getExtension('WEBGL_debug_renderer_info');
    world.dataset.renderer = gl.getParameter(driver ? driver.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    world.dataset.stage = 'terrain-audit';
    if (pair) world.dataset.trackbedAudit = JSON.stringify(auditTrackbed(scenery.group, rail, pair));
  }
  world.dataset.stage = 'rolling-stock';
  const atmosphere = new Atmosphere(scene, ROLLING_STOCK_SHADOW_LAYER);
  const cameras = new Cameras();
  const outline = !networkData && routeCatalog.length > 1
    ? await readWorldAsset<OverviewRoute[]>('data/overview-r40.json.gz') : null;
  const overview = networkData ? new NetworkOverview(networkData.routes)
    : outline ? new NetworkOverview(outline, 1) : null;
  if (overview) {
    scene.add(overview.group);
    cameras.allowMapExtent(overview.fitHeight * 1.35);
  }
  const cab = createCab(dashboard);
  const coaches = [createTrain(true, steel), createTrain(false, steel), createTrain(true, steel)];
  scene.add(cab.group, ...coaches.map(coach => coach.group));
  const trafficModels = new Map<string, ReturnType<typeof createTrain>[]>();
  const matrix = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const inverse = new Quaternion();

  function place(group: Group, distance: number): void {
    const front = rail.position(distance + 8.3);
    const rear = rail.position(distance - 8.3);
    group.position.copy(front).lerp(rear, 0.5);
    matrix.lookAt(rear, front, up);
    group.quaternion.setFromRotationMatrix(matrix);
    group.rotateZ(rail.pose(distance, 6).cant);
  }

  let paused = false;

  function placeConsist(
    consist: ReturnType<typeof createTrain>[],
    movement: Service,
    elapsed: number,
    hideNose: boolean,
  ): void {
    const reversed = movement.reversals % 2 !== 0;
    const leadIndex = reversed ? 2 : 0;
    const reference = movement.chainage();
    consist.forEach((coach, index) => {
      const order = reversed ? 2 - index : index;
      const distance = reference - order * 24.6;
      const backward = index === 1 ? reversed : index !== leadIndex;
      place(coach.group, distance);
      if (backward) coach.group.rotateY(Math.PI);
      inverse.copy(coach.group.quaternion).invert();
      const direction = backward ? -1 : 1;
      coach.bogies.forEach((bogie, axle) => {
        const pose = rail.pose(distance + direction * (axle === 0 ? 8.3 : -8.3), 2);
        bogie.position.copy(pose.position).sub(coach.group.position).applyQuaternion(inverse);
        matrix.lookAt(pose.position, pose.position.clone().addScaledVector(pose.tangent, direction), up);
        bogie.quaternion.setFromRotationMatrix(matrix).premultiply(inverse);
      });
      coach.group.visible = !(hideNose && index === leadIndex);
      coach.update({ ...movement.controls, speed: movement.state.speed, night: night || movement.trackSpan.tunnel, deltaSeconds: elapsed,
        headlights: index === leadIndex });
      if (coach.group.visible) coach.group.updateMatrixWorld();
    });
  }

  function resize(): void {
    dirty = true;
    renderer.setSize(world.clientWidth, world.clientHeight);
    cameras.camera.aspect = world.clientWidth / world.clientHeight;
    cameras.camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let weather: Weather = 'clear';
  let night = false;
  let timeScale = 1;
  let temporaryNotice = '';
  let noticeUntil = 0;
  let audio: AudioContext | undefined;
  const notice = element('notice');
  const routeSelect = element<HTMLSelectElement>('route-picker');
  const stationSelect = element<HTMLSelectElement>('map-station');
  const mapStations = new Map<number, Station>();
  for (const route of networkData?.routes ?? []) {
    for (const station of route.stations) mapStations.set(station.osmId, station);
  }
  stationSelect.add(new Option('Find station', ''));
  for (const station of [...mapStations.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'))) {
    stationSelect.add(new Option(station.name, String(station.osmId)));
  }
  stationSelect.addEventListener('change', () => {
    const station = mapStations.get(Number(stationSelect.value));
    if (!station) return;
    const [east, north] = station.position;
    delete world.dataset.view;
    cameras.fitMap(new Vector3(east, 0, -north), cab.group.position, 95);
    element('fit-network').textContent = 'Fit network';
    dirty = true;
  });
  for (const route of routeCatalog) routeSelect.add(new Option(`${route.ref} · ${route.name}`, route.ref));
  routeSelect.value = data.service;
  routeSelect.hidden = routeCatalog.length < 2;
  routeSelect.addEventListener('change', () => {
    const destination = new URL(window.location.href);
    destination.searchParams.set('line', routeSelect.value);
    destination.searchParams.delete('audit');
    location.assign(destination.href);
  });
  element('journey').textContent = [service.stops[0], service.stops.at(-1)!].map(station => station.name).join(' → ');
  element('line').textContent = data.service;
  const departure = data.timetable ? timetableSeconds(data.timetable.departure) : 0;
  const arrival = data.timetable ? timetableSeconds(data.timetable.arrival) : 0;

  function updateMapScenery(seconds: number, camera: Vector3, focus?: Vector3): void {
    let target: NetworkRoute | undefined;
    if (focus && !activeStream?.coversMapFocus(focus)) {
      target = otherRoutes.find(route => route.tiles.some(tile => {
        const bounds = tile.bounds;
        return bounds && focus.x >= bounds[0] && focus.x <= bounds[2]
          && -focus.z >= bounds[1] && -focus.z <= bounds[3];
      }));
    }
    let next = target && mapStreams.get(target);
    if (target && !next) {
      next = new SceneryStream(target.tiles, maps, new Rail(target.rail), target.spans, sceneryError, sceneryChanged);
      mapStreams.set(target, next);
    }
    if (mapStream !== next) {
      mapStream?.update(0, camera);
      mapStream?.group.removeFromParent();
      if (next) scene.add(next.group);
      mapStream = next;
    }
    if (next) {
      next.setNight(night);
      next.setWeather(weather);
      next.update(seconds, camera, undefined, focus);
    }
    if (target && focus && next?.heightAt(focus.x, focus.z) !== undefined) world.dataset.detailLine = target.ref;
    else delete world.dataset.detailLine;
  }

  function showNotice(message: string): void {
    temporaryNotice = message;
    noticeUntil = performance.now() + 3500;
  }

  function configureWeather(): void {
    dirty = true;
    atmosphere.set(night, weather);
    scene.environment = night ? nightReflection : dayReflection;
    scene.environmentIntensity = night ? 0.38 : 0.55;
    scenery.setWeather(weather);
    scenery.setNight(night);
    element('day').textContent = night ? 'Night' : 'Day';
    element('weather').textContent = weather[0].toUpperCase() + weather.slice(1);
  }

  function switchView(view: View): void {
    if (cameras.view !== view) delete world.dataset.view;
    cameras.select(view);
    element('fit-network').hidden = !overview || view !== 'map';
    stationSelect.hidden = !mapStations.size || view !== 'map';
    dirty = true;
    for (const selector of ['cab', 'chase', 'map']) {
      element(`${selector}-view`).setAttribute('aria-pressed', String(selector === view));
    }
  }

  function drive(control: 'throttle' | 'brake', increment: number): void {
    service.automatic = false;
    service.controls[control] = Math.max(0, Math.min(1, Math.round((service.controls[control] + increment) * 5) / 5));
  }

  function horn(): void {
    audio ??= new AudioContext();
    void audio.resume();
    const envelope = audio.createGain();
    const start = audio.currentTime;
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.exponentialRampToValueAtTime(0.09, start + 0.06);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.74);
    envelope.connect(audio.destination);
    for (const frequency of [244, 318]) {
      const oscillator = audio.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.connect(envelope);
      oscillator.start(start);
      oscillator.stop(start + 0.76);
    }
  }

  const actions: Record<string, () => void> = {
    'cab-view': () => switchView('cab'),
    'chase-view': () => switchView('chase'),
    'map-view': () => switchView('map'),
    'fit-network': () => {
      if (!overview) return;
      const expanded = cameras.mapHeight > 5000;
      cameras.fitMap(expanded ? cab.group.position : overview.center, cab.group.position,
        expanded ? 530 : overview.fitHeight, expanded);
      stationSelect.value = '';
      element('fit-network').textContent = expanded ? 'Fit network' : 'Follow train';
    },
    day: () => { night = !night; configureWeather(); },
    weather: () => { weather = weather === 'clear' ? 'rain' : weather === 'rain' ? 'snow' : 'clear'; configureWeather(); },
    compression: () => { timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 5 : 1; element('compression').textContent = `${timeScale}×`; },
    pause: () => {
      paused = !paused;
      dirty = true;
      const button = element('pause');
      button.firstChild!.textContent = paused ? 'Resume ' : 'Pause ';
      button.setAttribute('aria-pressed', String(paused));
    },
    'more-power': () => drive('throttle', 0.2),
    'less-power': () => drive('throttle', -0.2),
    'more-brake': () => drive('brake', 0.2),
    'less-brake': () => drive('brake', -0.2),
    doors: () => { if (!service.toggleDoors()) showNotice('Stop the train before opening the doors.'); },
    horn,
    auto: () => { service.automatic = !service.automatic; },
  };

  const keys: Record<string, string> = {
    '1': 'cab-view', '2': 'chase-view', '3': 'map-view',
    w: 'more-power', s: 'less-power', e: 'more-brake', q: 'less-brake',
    d: 'doors', h: 'horn', a: 'auto', t: 'compression', p: 'pause',
  };
  for (const [id, action] of Object.entries(actions)) {
    element(id).addEventListener('click', () => { dirty = true; action(); });
  }
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLSelectElement) return;
    const id = keys[event.key.toLowerCase()];
    if (!id) return;
    event.preventDefault();
    if (event.repeat && !['more-power', 'less-power', 'more-brake', 'less-brake'].includes(id)) return;
    dirty = true;
    actions[id]();
  });
  renderer.domElement.addEventListener('pointerdown', event => renderer.domElement.setPointerCapture(event.pointerId));
  renderer.domElement.addEventListener('pointermove', event => {
    if (event.buttons & 1) {
      cameras.drag(event.movementX, event.movementY);
      dirty = true;
    }
  });
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault();
    cameras.zoom(event.deltaY);
    if (cameras.view === 'map') {
      element('fit-network').textContent = cameras.mapHeight > 5000 ? 'Follow train' : 'Fit network';
    }
    dirty = true;
  }, { passive: false });

  const speed = element('speed');
  const limit = element('limit');
  const nextStop = element('next-stop');
  const signal = element('signal');
  const mappedSignals = data.features.filter(feature => feature.type === 'signal' && feature.chainage !== undefined);
  const tunnels = data.spans.filter(span => span.tunnel).reduce<{ start: number; end: number }[]>((portals, span) => {
    const previous = portals.at(-1);
    if (previous && span.start - previous.end < 0.01) previous.end = span.end;
    else portals.push({ start: span.start, end: span.end });
    return portals;
  }, []);
  const clock = element('clock');
  const throttle = element<HTMLMeterElement>('power');
  const brake = element<HTMLMeterElement>('brake');
  let previous = performance.now();
  let nextHud = previous;
  let previousReversals = service.reversals;
  function frame(now: number): void {
    const frameStart = audit ? performance.now() : 0;
    if (audit && !paused) performance.mark('station-frame-start');
    const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (paused && !dirty && !cameras.needsUpdate) {
      requestAnimationFrame(frame);
      return;
    }
    dirty = false;
    const state = paused ? service.state : service.tick(elapsed * timeScale);
    if (!paused) traffic?.update(state.elapsed, elapsed * timeScale);
    markPhase('station-simulation-end');
    const chainage = service.chainage();
    if (service.reversals !== previousReversals) {
      cameras.relocate();
      previousReversals = service.reversals;
    }
    place(cab.group, chainage);
    const inTunnel = service.trackSpan.tunnel;
    const visual = { ...service.controls, speed: state.speed, night: night || inTunnel, deltaSeconds: elapsed };
    cab.group.visible = cameras.view === 'cab';
    if (cab.group.visible) {
      cab.update(visual);
      cab.group.updateMatrixWorld();
    }
    placeConsist(coaches, service, elapsed, cameras.view === 'cab');
    if (traffic) {
      const visible = new Set<string>();
      for (const movement of traffic.active) {
        if (Math.abs(movement.chainage() - chainage) > 1600) continue;
        visible.add(movement.id);
        let consist = trafficModels.get(movement.id);
        if (!consist) {
          consist = [createTrain(true, steel), createTrain(false, steel), createTrain(true, steel)];
          trafficModels.set(movement.id, consist);
          scene.add(...consist.map(coach => coach.group));
        }
        placeConsist(consist, movement, elapsed, false);
      }
      for (const [id, consist] of trafficModels) {
        if (!visible.has(id)) consist.forEach(coach => { coach.group.visible = false; });
      }
    }
    const chaseDistance = chainage + 19;
    const portal = cameras.view === 'chase'
      ? tunnels.find(span => chaseDistance >= span.start - 18 && chaseDistance <= span.end + 18)
      : undefined;
    const tunnel = portal && rail.pose(chaseDistance);
    const transition = portal ? Math.min(1, (Math.min(chaseDistance - portal.start, portal.end - chaseDistance) + 18) / 18) : 0;
    const weight = transition * transition * (3 - 2 * transition);
    cameras.update(cab.group, cab.eye, elapsed, heightAt, tunnel && { ...tunnel, weight });
    if (overview) {
      const height = Math.max(0, cameras.camera.position.y - cab.group.position.y);
      const shown = cameras.view === 'map' && height > 1800;
      const markers = shown ? [cab.group.position, ...(traffic?.active.map(movement => rail.position(movement.chainage())) ?? [])] : [];
      overview.update(shown, height, cameras.camera.position, markers);
    }
    const visualTime = paused ? 0 : elapsed;
    const liveStockShadows = cameras.view === 'chase' || (cameras.view === 'map' && cameras.mapHeight <= 180)
      || (traffic?.active.some(movement => Math.abs(movement.chainage() - chainage) <= 180) ?? false);
    atmosphere.update(cab.group.position, cameras.camera.position, visualTime,
      inTunnel && cameras.view === 'cab', liveStockShadows);
    scenery.update(visualTime, cameras.camera.position, chainage, cameras.mapFocus);
    updateMapScenery(visualTime, cameras.camera.position, cameras.mapFocus);
    markPhase('station-render-start');
    renderer.render(scene, cameras.camera);
    markPhase('station-render-end');
    if (now >= nextHud || paused) {
      if (audit) {
        world.dataset.drawCalls = String(renderer.info.render.calls);
        world.dataset.triangles = String(renderer.info.render.triangles);
      }
      world.dataset.stage = 'running';
      if (cameras.settled) world.dataset.view = cameras.view;
      world.dataset.chainage = chainage.toFixed(2);
      world.dataset.structure = service.trackSpan.tunnel ? 'tunnel' : service.trackSpan.bridge ? 'bridge' : 'open';
      const station = service.nextStop;
      const remaining = station ? station.stopDistance - chainage : 0;
      speed.textContent = String(Math.round(state.speed * 3.6));
      limit.textContent = String(service.trackSpan.speedLimit ?? '—');
      limit.dataset.speeding = String(service.speeding);
      const authority = service.authority;
      let upcoming = '';
      for (const feature of mappedSignals) {
        const chainage = feature.chainage!;
        if (Math.abs(chainage - service.chainage()) > 2100 && chainage !== authority.boundary) continue;
        const direction = feature.facesService ? 1 : -1;
        const arriving = chainage === authority.boundary && feature.facesService;
        const displayed = service.blocks.aspect(arriving ? 'player' : 'next-train', chainage - direction * 0.01, direction);
        scenery.setSignal(displayed.aspect, feature.osmId);
        if (chainage === authority.boundary && feature.facesService) {
          const label = feature.tags.ref ?? 'Signal';
          upcoming = `${label} · ${authority.aspect} · ${Math.max(0, Math.round(chainage - service.chainage()))} m`;
        }
      }
      signal.textContent = upcoming;
      signal.dataset.aspect = authority.aspect;
      const arrivalPlan = data.timetable?.calls?.[service.nextIndex]?.arrival ?? data.timetable?.arrival;
      const planned = arrivalPlan && station ? ` · ${arrivalPlan.slice(0, 5)}` : '';
      nextStop.textContent = station ? `${station.name} · ${Math.max(0, Math.round(remaining))} m${planned}` : 'Service complete';
      const seconds = Math.floor(state.elapsed) + departure;
      clock.textContent = new Date(seconds * 1000).toISOString().slice(11, 19);
      throttle.value = service.controls.throttle;
      brake.value = service.controls.brake;
      element('doors').setAttribute('aria-pressed', String(service.controls.doorsOpen));
      element('auto').setAttribute('aria-pressed', String(service.automatic));
      const timing = service.arrivalTime === null ? 0 : Math.round(departure + service.arrivalTime - arrival);
      const schedule = data.timetable
        ? timing === 0 ? ' · on time' : ` · ${Math.abs(timing)} s ${timing < 0 ? 'early' : 'late'}`
        : '';
      const score = data.timetable ? service.score(arrival - departure) : null;
      const result = score === null ? 'Service complete' : `Score ${score}/100`;
      notice.textContent = now < noticeUntil ? temporaryNotice
        : !station ? `${result} · ${Math.abs(service.stoppingError ?? 0).toFixed(1)} m stopping error${schedule}`
          : remaining < -7 ? 'Stop missed' : service.speeding ? 'Above line speed' : '';
      nextHud = now + 100;
    }
    if (audit && !paused) {
      performance.mark('station-frame-end');
      performance.measure('station-frame', { start: frameStart, end: performance.now(), detail: now });
      performance.clearMeasures('station-frame');
      performance.clearMarks('station-frame-start');
      performance.clearMarks('station-frame-end');
    }
    requestAnimationFrame(frame);
  }
  world.dataset.stage = 'rendering';
  requestAnimationFrame(frame);
}

run().catch((error: unknown) => {
  element('notice').textContent = error instanceof Error ? error.message : 'The simulator failed to start.';
  console.error(error);
});
