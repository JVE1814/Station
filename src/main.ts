import {
  ACESFilmicToneMapping, Group, Matrix4, PCFShadowMap, Quaternion, Scene, Vector3, WebGLRenderer,
} from 'three';
import { Atmosphere, skyReflection } from './atmosphere';
import type { Weather } from './atmosphere';
import { Cameras } from './cameras';
import type { View } from './cameras';
import { Rail } from './rail';
import { createCab, createTrain } from './rolling-stock';
import { auditTrackbed, createScenery } from './scenery';
import { Service } from './service';
import type { WorldData } from './world-data';
import './style.css';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing simulator control ${id}`);
  return item as T;
}

async function run(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/service.json`);
  if (!response.ok) throw new Error('The offline service file could not be loaded.');
  const data: WorldData = await response.json();
  const rail = new Rail(data.rail);
  const service = new Service(data, rail);
  const scene = new Scene();
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
  const scenery = createScenery(data, rail);
  scene.add(scenery.group);
  const audit = new URLSearchParams(location.search).get('audit') === 'trackbed';
  if (audit) {
    const gl = renderer.getContext();
    const driver = gl.getExtension('WEBGL_debug_renderer_info');
    world.dataset.renderer = gl.getParameter(driver ? driver.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    world.dataset.stage = 'terrain-audit';
    world.dataset.trackbedAudit = JSON.stringify(auditTrackbed(scenery.group, rail, data));
  }
  world.dataset.stage = 'rolling-stock';
  const atmosphere = new Atmosphere(scene);
  const cameras = new Cameras();
  const cab = createCab();
  const coaches = [createTrain(true), createTrain(false), createTrain(false)];
  scene.add(cab.group, ...coaches.map(coach => coach.group));
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

  function resize(): void {
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
  element('journey').textContent = data.stations.map(station => station.name).join(' → ');
  element('line').textContent = data.service;
  const timetableSeconds = (hhmmss: string) => hhmmss.split(':').map(Number)
    .reduce((seconds, component) => seconds * 60 + component, 0);
  const departure = data.timetable ? timetableSeconds(data.timetable.departure) : 0;
  const arrival = data.timetable ? timetableSeconds(data.timetable.arrival) : 0;

  function showNotice(message: string): void {
    temporaryNotice = message;
    noticeUntil = performance.now() + 3500;
  }

  function configureWeather(): void {
    atmosphere.set(night, weather);
    scene.environment = night ? nightReflection : dayReflection;
    scene.environmentIntensity = night ? 0.25 : 0.55;
    scenery.setWeather(weather);
    scenery.setNight(night);
    element('day').textContent = night ? 'Night' : 'Day';
    element('weather').textContent = weather[0].toUpperCase() + weather.slice(1);
  }

  function switchView(view: View): void {
    if (cameras.view !== view) delete world.dataset.view;
    cameras.select(view);
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
    day: () => { night = !night; configureWeather(); },
    weather: () => { weather = weather === 'clear' ? 'rain' : weather === 'rain' ? 'snow' : 'clear'; configureWeather(); },
    compression: () => { timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 5 : 1; element('compression').textContent = `${timeScale}×`; },
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
    d: 'doors', h: 'horn', a: 'auto', t: 'compression',
  };
  for (const [id, action] of Object.entries(actions)) element(id).addEventListener('click', action);
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const id = keys[event.key.toLowerCase()];
    if (!id) return;
    event.preventDefault();
    if (event.repeat && !['more-power', 'less-power', 'more-brake', 'less-brake'].includes(id)) return;
    actions[id]();
  });
  renderer.domElement.addEventListener('pointerdown', event => renderer.domElement.setPointerCapture(event.pointerId));
  renderer.domElement.addEventListener('pointermove', event => {
    if (event.buttons & 1) cameras.drag(event.movementX, event.movementY);
  });
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault();
    cameras.zoom(event.deltaY);
  }, { passive: false });

  const speed = element('speed');
  const limit = element('limit');
  const nextStop = element('next-stop');
  const clock = element('clock');
  const throttle = element<HTMLMeterElement>('power');
  const brake = element<HTMLMeterElement>('brake');
  let previous = performance.now();
  let nextHud = previous;
  function frame(now: number): void {
    const frameStart = audit ? performance.now() : 0;
    const elapsed = Math.min(0.1, Math.max(0, (now - previous) / 1000));
    previous = now;
    const state = service.tick(elapsed * timeScale);
    place(cab.group, state.distance);
    const visual = { ...service.controls, speed: state.speed, night, deltaSeconds: elapsed };
    cab.update(visual);
    cab.group.visible = cameras.view === 'cab';
    coaches.forEach((coach, index) => {
      const distance = state.distance - index * 24.6;
      place(coach.group, distance);
      inverse.copy(coach.group.quaternion).invert();
      coach.bogies.forEach((bogie, axle) => {
        const pose = rail.pose(distance + (axle === 0 ? 8.3 : -8.3), 2);
        bogie.position.copy(pose.position).sub(coach.group.position).applyQuaternion(inverse);
        matrix.lookAt(pose.position, pose.position.clone().add(pose.tangent), up);
        bogie.quaternion.setFromRotationMatrix(matrix).premultiply(inverse);
      });
      coach.group.visible = index > 0 || cameras.view !== 'cab';
      coach.update(visual);
    });
    cameras.update(cab.group, cab.eye, elapsed);
    atmosphere.update(cab.group.position, cameras.camera.position, elapsed);
    scenery.update(elapsed);
    renderer.render(scene, cameras.camera);
    if (now >= nextHud) {
      world.dataset.stage = 'running';
      if (cameras.settled) world.dataset.view = cameras.view;
      world.dataset.chainage = state.distance.toFixed(2);
      world.dataset.structure = service.trackSpan.tunnel ? 'tunnel' : service.trackSpan.bridge ? 'bridge' : 'open';
      const station = service.nextStop;
      const remaining = station ? station.stopDistance - state.distance : 0;
      speed.textContent = String(Math.round(state.speed * 3.6));
      limit.textContent = String(service.trackSpan.speedLimit ?? '—');
      const planned = data.timetable && station ? ` · ${data.timetable.arrival.slice(0, 5)}` : '';
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
          : remaining < -7 ? 'Stop missed' : '';
      nextHud = now + 100;
    }
    if (audit) {
      performance.measure('station-frame', { start: frameStart, end: performance.now() });
      performance.clearMeasures('station-frame');
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
