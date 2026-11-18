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
import type { RailPose } from './rail';
import { createCab, createTrain, ROLLING_STOCK_SHADOW_LAYER } from './rolling-stock';
import { auditTrackbed, createScenery } from './scenery';
import { Service } from './service';
import { SceneryStream } from './streaming';
import { Traffic } from './traffic';
import { groundHeight, timetableSeconds } from './world-data';
import type { Station, WorldData } from './world-data';
import { frameHero, heroShots } from './hero';
import { parseQuality, ShowpieceLight } from './showpiece-light';
import { ShowpiecePanel, StoppingMarker } from './showpiece-ui';
import { DrivingTutorial, STOPPED_SPEED } from './driving';
import { createLakesideProfile, StationAudio } from './audio';
import { WaterReflection } from './water-reflection';
import './style.css';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing simulator control ${id}`);
  return item as T;
}

async function run(): Promise<void> {
  const options = new URLSearchParams(location.search);
  const ref = options.get('line') ?? 'R40';
  const networkData = ref && ['R40', 'F4', 'F5', 'F6'].includes(ref) ? await loadNetworkRoute(ref) : null;
  const network = networkData?.line;
  const pair = network ? null : await readWorldAsset<WorldData>('data/service.json');
  if (!network && !pair) throw new Error('The offline service file could not be loaded.');
  const data = network ? { ...network, service: network.ref } : pair!;
  const rail = new Rail(data.rail);
  const gallery = network?.ref === 'R40' && options.has('hero') ? heroShots(network) : [];
  let shot = gallery.find(item => item.id === options.get('hero'));
  const showpiece = network?.ref === 'R40';
  if (showpiece) element('notice').textContent = 'Loading Evanger–Voss scenery…';
  const galleryStart = (selected: (typeof gallery)[number]) => ({ distance: selected.distance, speed: selected.speed,
    nextIndex: Math.max(1, data.stations.findIndex(station => station.stopDistance > selected.distance)), driving: true });
  let service = new Service(data, rail, shot ? galleryStart(shot) : { driving: showpiece });
  let traffic = network?.traffic?.length ? new Traffic(data, rail, service, network.traffic) : null;
  const quality = parseQuality(options.get('quality') ?? localStorage.getItem('station-r40-quality'));
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
  const [pineAndBirch, terrainDetail] = showpiece ? await Promise.all([
    loadMap('norway-trees'), loadMap('r40-ground'),
  ]) : [];
  const waterReflection = showpiece ? new WaterReflection() : undefined;
  const maps = { grass, ballast, spruce, siding, roofing, pineAndBirch, terrainDetail, waterReflection, polished: showpiece };
  let dirty = true;
  const sceneryChanged = () => { dirty = true; };
  const sceneryError = (error: unknown) => {
    element('notice').textContent = 'A scenery tile could not be loaded.';
    console.error(error);
  };
  const activeStream = network
    ? new SceneryStream(network.tiles, maps, rail, data.spans, sceneryError, sceneryChanged) : undefined;
  const scenery = activeStream ?? createScenery(pair!, rail, maps);
  if (activeStream) await activeStream.ready(service.chainage(), shot ? 2300 : 0);
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
  const atmosphere = new Atmosphere(scene, ROLLING_STOCK_SHADOW_LAYER, showpiece);
  const cameras = new Cameras(showpiece && !shot);
  const lighting = showpiece ? new ShowpieceLight(scene, cameras.camera, ROLLING_STOCK_SHADOW_LAYER, quality) : undefined;
  if (lighting) renderer.info.autoReset = false;
  const panel = showpiece ? new ShowpiecePanel() : undefined;
  const marker = showpiece ? new StoppingMarker() : undefined;
  const audio = new StationAudio();
  const lakesideAt = createLakesideProfile(data, rail);
  let tutorial: DrivingTutorial | undefined;
  if (showpiece) {
    document.body.classList.add('showpiece');
    element('geo-credits').textContent = '© OpenStreetMap contributors · Kartverket · Entur';
    for (const id of ['brake-cue', 'quality', 'retry', 'tutorial', 'mute', 'brake-notch', 'power-notch']) element(id).hidden = false;
    element<HTMLSelectElement>('quality').value = quality;
    element<HTMLSelectElement>('quality').addEventListener('change', event => {
      const selector = event.target as HTMLSelectElement;
      const preset = parseQuality(selector.value);
      lighting?.setQuality(preset);
      localStorage.setItem('station-r40-quality', preset);
      selector.blur();
      dirty = true;
    });
  }
  if (marker) scene.add(marker.group);
  if (shot) {
    frameHero(cameras, shot, rail.position(shot.distance));
    document.body.classList.add('hero-capture');
  }
  const outline = !networkData && routeCatalog.length > 1
    ? await readWorldAsset<OverviewRoute[]>('data/overview-r40.json.gz') : null;
  const overview = networkData ? new NetworkOverview(networkData.routes)
    : outline ? new NetworkOverview(outline, 1) : null;
  if (overview) {
    scene.add(overview.group);
    cameras.allowMapExtent(overview.fitHeight * 1.35);
  }
  const cab = createCab(dashboard, showpiece);
  const coaches = [createTrain(true, steel, showpiece), createTrain(false, steel, showpiece), createTrain(true, steel, showpiece)];
  scene.add(cab.group, ...coaches.map(coach => coach.group));
  lighting?.addTree(cab.group);
  for (const coach of coaches) lighting?.addTree(coach.group);
  const trafficModels = new Map<string, ReturnType<typeof createTrain>[]>();
  const matrix = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const inverse = new Quaternion();
  const stockShadowCenter = new Vector3();
  const stockFront = new Vector3();
  const stockRear = new Vector3();
  const bogieAim = new Vector3();
  const boardingSills = Array.from({ length: 12 }, () => new Vector3());
  const stockPose: RailPose = { position: new Vector3(), tangent: new Vector3(), cant: 0 };

  function place(group: Group, distance: number): void {
    const front = rail.position(distance + 8.3, stockFront);
    const rear = rail.position(distance - 8.3, stockRear);
    group.position.copy(front).lerp(rear, 0.5);
    matrix.lookAt(rear, front, up);
    group.quaternion.setFromRotationMatrix(matrix);
    group.rotateZ(rail.pose(distance, 6, stockPose).cant);
  }

  let paused = Boolean(shot);

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
        const pose = rail.pose(distance + direction * (axle === 0 ? 8.3 : -8.3), 2, stockPose);
        bogie.position.copy(pose.position).sub(coach.group.position).applyQuaternion(inverse);
        bogieAim.copy(pose.position).addScaledVector(pose.tangent, direction);
        matrix.lookAt(pose.position, bogieAim, up);
        bogie.quaternion.setFromRotationMatrix(matrix).premultiply(inverse);
      });
      coach.group.visible = !(hideNose && index === leadIndex);
      coach.update({ ...movement.controls, speed: movement.state.speed, night: night || movement.trackSpan.tunnel, deltaSeconds: elapsed,
        headlights: index === leadIndex, weather });
      if (coach.group.visible) coach.group.updateMatrixWorld();
    });
  }

  function resize(): void {
    dirty = true;
    renderer.setSize(world.clientWidth, world.clientHeight);
    lighting?.resize(world.clientWidth, world.clientHeight, renderer.getPixelRatio());
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
  routeSelect.value = pair ? 'R40-short' : data.service;
  routeSelect.hidden = routeCatalog.length < 2;
  routeSelect.addEventListener('change', () => {
    const destination = new URL(window.location.href);
    destination.searchParams.set('line', routeSelect.value);
    for (const key of ['audit', 'hero', 'look']) destination.searchParams.delete(key);
    location.assign(destination.href);
  });
  if (shot && options.get('look') === 'night') night = true;
  if (shot && options.get('look') === 'snow') weather = 'snow';
  if (shot || showpiece) configureWeather();
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
      next = new SceneryStream(target.tiles, { ...maps, polished: target.ref === 'R40' }, new Rail(target.rail), target.spans, sceneryError, sceneryChanged);
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
    lighting?.set(night, weather);
    waterReflection?.invalidate();
    service.surface = weather;
    scene.environment = night ? nightReflection : dayReflection;
    scene.environmentIntensity = showpiece ? (night ? .59 : .73) : (night ? .38 : .55);
    scenery.setWeather(weather);
    scenery.setNight(night);
    element('day').textContent = night ? (showpiece ? 'Blue hour' : 'Night') : (showpiece ? 'Golden hour' : 'Day');
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
    service.adjustNotch(control, increment);
  }

  function restart(practice: boolean): void {
    if (!showpiece) return;
    service = new Service(data, rail, { driving: true, training: practice });
    service.surface = weather;
    traffic = network?.traffic?.length ? new Traffic(data, rail, service, network.traffic) : null;
    for (const consist of trafficModels.values()) for (const coach of consist) scene.remove(coach.group);
    trafficModels.clear();
    tutorial = practice ? new DrivingTutorial() : undefined;
    element('brake-cue').hidden = practice;
    element('route-advice').hidden = practice;
    panel?.reset(tutorial);
    temporaryNotice = '';
    noticeUntil = 0;
    if (paused) actions.pause();
    switchView('cab');
    cameras.relocate();
    dirty = true;
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
    compression: () => { timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 5 : 1; element('compression-value').textContent = `${timeScale}×`; },
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
    doors: () => {
      if (!service.toggleDoors()) showNotice(service.boardingRemaining > 0 ? 'Boarding is still in progress.'
        : showpiece && service.state.speed <= STOPPED_SPEED ? 'Stop at the platform marker before opening the doors.'
          : 'Stop the train before opening the doors.');
    },
    horn: () => audio.horn(),
    tutorial: () => restart(true),
    retry: () => restart(false),
    'hide-result': () => { element('trip-result').hidden = true; },
    mute: () => {
      const button = element('mute');
      const muted = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(muted));
      button.textContent = muted ? 'Muted' : 'Sound';
      audio.setMuted(muted);
    },
    auto: () => { service.automatic = !service.automatic; },
  };

  const keys: Record<string, string> = {
    '1': 'cab-view', '2': 'chase-view', '3': 'map-view',
    w: 'more-power', s: 'less-power', e: 'more-brake', q: 'less-brake',
    d: 'doors', h: 'horn', a: 'auto', t: 'compression', p: 'pause', r: 'retry', l: 'tutorial', escape: 'hide-result',
  };
  for (const [id, action] of Object.entries(actions)) {
    element(id).addEventListener('click', () => { audio.unlock(); dirty = true; action(); });
  }
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLSelectElement) return;
    const id = keys[event.key.toLowerCase()];
    if (!id) return;
    event.preventDefault();
    if (event.repeat && !['more-power', 'less-power', 'more-brake', 'less-brake'].includes(id)) return;
    audio.unlock();
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
  const separateClock = showpiece && !shot;
  let previous = performance.now();
  let nextHud = previous;
  let nextStatus = previous;
  let previousReversals = service.reversals;
  let preparingCapture = false;

  if (shot) {
    world.dataset.captureControls = 'ready';
    window.addEventListener('station-capture', async event => {
      const request = (event as CustomEvent<{ id: string; look: string }>).detail;
      const selected = gallery.find(item => item.id === request?.id);
      if (!selected || preparingCapture || !['golden', 'night', 'snow'].includes(request.look)) return;
      preparingCapture = true;
      world.dataset.stage = 'scenery';
      try {
        if (selected !== shot) {
          await activeStream?.ready(selected.distance, 2300);
          shot = selected;
          service = new Service(data, rail, galleryStart(selected));
          frameHero(cameras, selected, rail.position(selected.distance));
        }
        night = request.look === 'night';
        weather = request.look === 'snow' ? 'snow' : 'clear';
        configureWeather();
      } catch (error) {
        world.dataset.stage = 'failed';
        console.error(error);
      } finally {
        preparingCapture = false;
      }
    });
  }

  function advance(simulationTime: number): void {
    if (paused) return;
    const state = service.tick(simulationTime);
    traffic?.update(state.elapsed, simulationTime);
    tutorial?.update(service.controls, state, cameras.view);
  }

  function updateHud(now: number): void {
    const chainage = service.chainage();
    const { state } = service;
    const station = service.nextStop;
    const remaining = station ? station.stopDistance - chainage : 0;
    const speedKmh = state.speed * 3.6;
    speed.textContent = showpiece && state.speed > STOPPED_SPEED && speedKmh < 2
      ? Math.max(.1, speedKmh).toFixed(1) : String(Math.round(speedKmh));
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
    signal.textContent = showpiece ? '' : upcoming;
    panel?.update(service, weather, tutorial);
    signal.dataset.aspect = authority.aspect;
    const arrivalPlan = data.timetable?.calls?.[service.nextIndex]?.arrival ?? data.timetable?.arrival;
    const planned = arrivalPlan && station ? ` · ${arrivalPlan.slice(0, 5)}` : '';
    const position = showpiece && remaining < -1 ? `${Math.round(-remaining)} m past marker`
      : `${Math.max(0, Math.round(remaining))} m`;
    nextStop.textContent = tutorial ? 'Practice at Evanger'
      : station ? `${station.name} · ${position}${planned}` : 'Service complete';
    const seconds = Math.floor(state.elapsed) + departure;
    clock.textContent = new Date(seconds * 1000).toISOString().slice(11, 19);
    throttle.value = service.controls.throttle;
    brake.value = service.controls.brake;
    if (showpiece) {
      element('power-notch').textContent = String(Math.round(5 * service.controls.throttle));
      element('brake-notch').textContent = String(Math.round(5 * service.controls.brake));
    }
    element('doors').setAttribute('aria-pressed', String(service.controls.doorsOpen));
    element('auto').setAttribute('aria-pressed', String(service.automatic));
    const timing = service.arrivalTime === null ? 0 : Math.round(departure + service.arrivalTime - arrival);
    const schedule = data.timetable
      ? timing === 0 ? ' · on time' : ` · ${Math.abs(timing)} s ${timing < 0 ? 'early' : 'late'}`
      : '';
    const score = showpiece ? service.finalResult?.score ?? null : data.timetable ? service.score(arrival - departure) : null;
    const result = score === null ? 'Service complete' : `Score ${score}/100`;
    notice.textContent = now < noticeUntil ? temporaryNotice
      : !station ? `${result} · ${Math.abs(service.stoppingError ?? 0).toFixed(1)} m stopping error${schedule}`
        : remaining < -7 ? (showpiece ? 'Stop missed · R to retry' : 'Stop missed') : service.speeding ? 'Above line speed' : '';
  }

  if (separateClock) {
    let lastTick = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const seconds = Math.min(.35, (now - lastTick) / 1000);
      lastTick = now;
      if (world.dataset.stage !== 'running') return;
      advance(seconds * timeScale);
      const { state, trackSpan } = service;
      audio.update({ ...service.effort, doorsOpen: service.controls.doorsOpen, brakeCommand: service.controls.brake,
        speed: state.speed, distance: state.distance, weather, tunnel: trackSpan.tunnel, bridge: trackSpan.bridge,
        lakeside: activeStream?.lakesideAt(service.chainage()) ?? 0, view: cameras.view, paused, timeScale });
      if (now >= nextHud) {
        updateHud(now);
        nextHud = now + 100;
      }
    }, 32);
  }

  function frame(now: number): void {
    const frameStart = audit ? performance.now() : 0;
    if (audit && !paused) performance.mark('station-frame-start');
    const wallTime = Math.max(0, (now - previous) / 1000);
    const elapsed = Math.min(.1, wallTime);
    previous = now;
    if (preparingCapture || paused && !dirty && !cameras.needsUpdate) {
      requestAnimationFrame(frame);
      return;
    }
    dirty = false;
    if (!separateClock) advance(elapsed * timeScale);
    const state = service.state;
    markPhase('station-simulation-end');
    const chainage = service.chainage();
    if (service.reversals !== previousReversals) {
      cameras.relocate();
      previousReversals = service.reversals;
    }
    place(cab.group, chainage);
    const inTunnel = shot ? data.spans.some(span => span.tunnel && span.start <= chainage && span.end > chainage) : service.trackSpan.tunnel;
    const visual = { ...service.controls, speed: state.speed, night: night || inTunnel, deltaSeconds: elapsed, weather };
    const stopMarker = service.controls.doorsOpen ? service.stops[service.nextIndex - 1] : service.nextStop;
    marker?.update(rail, stopMarker, chainage, !shot && !tutorial);
    const shoreline = activeStream?.lakesideAt(chainage) ?? lakesideAt(chainage);
    if (!shot && !separateClock) audio.update({ ...service.effort, doorsOpen: service.controls.doorsOpen, brakeCommand: service.controls.brake,
      speed: state.speed, distance: state.distance, weather, tunnel: inTunnel, bridge: service.trackSpan.bridge,
      lakeside: shoreline, view: cameras.view, paused, timeScale });
    cab.group.visible = cameras.view === 'cab';
    if (cab.group.visible) {
      cab.update(visual);
      cab.group.updateMatrixWorld();
    }
    placeConsist(coaches, service, elapsed, cameras.view === 'cab');
    if (showpiece) {
      const boarding = !shot && service.controls.doorsOpen && state.speed < .05;
      if (boarding) {
        let index = 0;
        for (const { group } of coaches) {
          for (const side of [-1, 1]) for (const offset of [-9.34, 9.42]) {
            boardingSills[index++].set(side * 1.55, 1.03, offset).applyQuaternion(group.quaternion).add(group.position);
          }
        }
      }
      activeStream?.setBoardingDoors(boarding ? boardingSills : []);
    }
    if (traffic) {
      const visible = new Set<string>();
      for (const movement of traffic.active) {
        if (Math.abs(movement.chainage() - chainage) > 1600) continue;
        visible.add(movement.id);
        let consist = trafficModels.get(movement.id);
        if (!consist) {
          consist = [createTrain(true, steel, showpiece), createTrain(false, steel, showpiece), createTrain(true, steel, showpiece)];
          trafficModels.set(movement.id, consist);
          scene.add(...consist.map(coach => coach.group));
          for (const coach of consist) lighting?.addTree(coach.group);
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
    cameras.motion(state.speed, chainage, state.acceleration, paused ? 0 : elapsed);
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
    const focus = liveStockShadows ? rail.position(chainage - 24.6, stockShadowCenter) : undefined;
    atmosphere.update(cab.group.position, cameras.camera.position, visualTime,
      inTunnel && cameras.view === 'cab', focus);
    scenery.update(visualTime, cameras.camera.position, chainage, cameras.mapFocus);
    updateMapScenery(visualTime, cameras.camera.position, cameras.mapFocus);
    markPhase('station-render-start');
    if (lighting) {
      for (const root of scenery.group.children) lighting.addTree(root);
      renderer.info.reset();
      lighting.render(renderer, cab.group.position, shot ? .1 : visualTime, inTunnel && cameras.view === 'cab', shoreline, waterReflection);
    } else renderer.render(scene, cameras.camera);
    markPhase('station-render-end');
    if (now >= nextStatus || paused) {
      world.dataset.stage = 'running';
      if (cameras.settled) world.dataset.view = cameras.view;
      if (shot) world.dataset.captureFrame = String(now);
      world.dataset.drawCalls = String(renderer.info.render.calls);
      world.dataset.triangles = String(renderer.info.render.triangles);
      world.dataset.chainage = chainage.toFixed(2);
      world.dataset.structure = service.trackSpan.tunnel ? 'tunnel' : service.trackSpan.bridge ? 'bridge' : 'open';
      nextStatus = now + 100;
    }
    if (!separateClock && (now >= nextHud || paused)) {
      updateHud(now);
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
  element('world').dataset.stage = 'failed';
  element('notice').textContent = error instanceof Error ? error.message : 'The simulator failed to start.';
  console.error(error);
});
