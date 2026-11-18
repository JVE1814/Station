import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { Weather } from './atmosphere';
import { PLATFORM_TOLERANCE, surfaceNames } from './driving.ts';
import type { DrivingTutorial } from './driving.ts';
import type { Rail } from './rail';
import type { Service } from './service';
import type { Station } from './world-data';

const number = (id: string) => document.getElementById(id)!;
const distance = (metres: number) => metres > 999 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;

function timing(seconds: number | null): string {
  return seconds === null ? 'Unscheduled' : Math.abs(seconds) < 2 ? 'On time' : `${Math.abs(Math.round(seconds))} s ${seconds > 0 ? 'late' : 'early'}`;
}

export class ShowpiecePanel {
  private lastResults = 0;

  reset(tutorial?: DrivingTutorial): void {
    this.lastResults = 0;
    number('trip-result').hidden = true;
    number('training').hidden = !tutorial;
  }

  update(service: Service, weather: Weather, tutorial?: DrivingTutorial): void {
    const { signal, speedChange, guidance } = service.preview;
    number('route-advice').hidden = Boolean(tutorial);
    number('preview-signal').textContent = signal ? `${signal.label} · ${signal.aspect} · ${distance(signal.distance)}` : 'No signal ahead';
    number('preview-signal').dataset.aspect = signal?.aspect ?? '';
    number('preview-limit').textContent = speedChange ? `${speedChange.limit} km/h in ${distance(speedChange.distance)}` : 'No speed change ahead';
    const guide = number('brake-cue');
    const inStopZone = service.nextStop && Math.abs(service.nextStop.stopDistance - service.chainage()) <= PLATFORM_TOLERANCE;
    guide.textContent = service.boardingRemaining > 0 ? `Boarding · ${Math.ceil(service.boardingRemaining)} s`
      : service.controls.doorsOpen ? `${service.nextStop ? 'Boarding complete' : 'Service complete'} · D to close doors`
      : !service.nextStop ? 'Service complete · R to retry'
      : service.canOpenDoors && !tutorial && inStopZone ? 'Within stop zone · D to open doors'
      : guidance.brakeNotch ? `Brake ${guidance.brakeNotch} · Aim for ${Math.round(guidance.recommendedSpeed)} km/h`
      : `${guidance.powerNotch ? `Power ${guidance.powerNotch}` : 'Coast'} · Aim for ${Math.round(guidance.recommendedSpeed)} km/h`;
    guide.dataset.brake = String(guidance.brakeNotch > 0 && service.state.speed > 1);
    number('grip').textContent = `${surfaceNames[weather]} · ${service.passengersAboard} aboard`;
    if (tutorial) {
      number('training-title').textContent = tutorial.step.title;
      number('training-step').textContent = tutorial.step.prompt;
      number('training-progress').textContent = tutorial.done ? 'Practice complete' : `Practice ${tutorial.index + 1} / ${tutorial.totalSteps}`;
    }
    if (service.stopResults.length > this.lastResults) {
      this.lastResults = service.stopResults.length;
      const stop = service.stopResults.at(-1)!;
      const final = service.finalResult;
      number('trip-result').hidden = false;
      number('result-title').textContent = final ? `Voss · Grade ${final.grade}` : stop.station;
      number('result-score').textContent = `${final?.score ?? stop.score} / 100`;
      number('result-timing').textContent = timing(stop.scheduleDelta);
      number('result-position').textContent = `${Math.abs(stop.stoppingError).toFixed(1)} m from marker`;
      number('result-passengers').textContent = final
        ? `${final.passengersCarried} carried · ${final.stops} stops`
        : `${stop.boarded} boarded · ${stop.alighted} alighted`;
    }
  }
}

export class StoppingMarker {
  readonly group = new Group();
  private readonly label = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false }));
  private station?: Station;

  constructor() {
    this.label.center.set(.5, 0);
    this.group.add(this.label);
  }

  update(rail: Rail, station: Station | undefined, chainage: number, enabled: boolean): void {
    const distance = station ? Math.abs(station.stopDistance - chainage) : Infinity;
    this.group.visible = enabled && distance < 300;
    if (!station || !this.group.visible) return;
    const size = 1 + Math.min(.7, distance / 94);
    this.label.scale.set(3.12 * size, 1.36 * size, 1);
    if (station === this.station) return;
    this.station = station;
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f3bd59';
    ctx.fillRect(12, 2, 360, 123);
    ctx.strokeStyle = '#2d271f';
    ctx.lineWidth = 5;
    ctx.strokeRect(18, 8, 348, 111);
    ctx.fillStyle = '#232520';
    ctx.textAlign = 'center';
    ctx.font = 'bold 75px system-ui';
    ctx.fillText('STOP', 192, 75);
    ctx.font = '28px system-ui';
    ctx.fillText(station.name, 192, 107, 310);
    ctx.fillStyle = '#f3bd59';
    ctx.beginPath();
    ctx.moveTo(164, 124); ctx.lineTo(192, 156); ctx.lineTo(220, 124); ctx.fill();
    this.label.material.map?.dispose();
    this.label.material.map = new CanvasTexture(canvas);
    this.label.material.map.colorSpace = SRGBColorSpace;
    this.label.material.needsUpdate = true;
    const marker = rail.pose(station.stopDistance + 12.28);
    this.group.position.copy(marker.position);
    this.group.position.x -= marker.tangent.z * 2.35;
    this.group.position.z += marker.tangent.x * 2.35;
    this.group.position.y += 1.45;
    this.group.updateMatrixWorld();
  }
}
