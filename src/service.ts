import { BlockController } from './blocks.ts';
import type { BlockAuthority } from './blocks.ts';
import { STEP, FixedSimulation, applyAcceleration, stepTrain } from './dynamics.ts';
import type { DriverControls, TrainState } from './dynamics.ts';
import type { Rail } from './rail';
import { timetableSeconds } from './world-data.ts';
import type { Station, TrackSpan } from './world-data';
import type { ServiceData } from './network';

const trainFront = 12.28;
const trainRear = 61.45;
const lastCoachOffset = 49.2;
interface StartState {
  id?: string;
  blocks?: BlockController;
  distance?: number;
  speed?: number;
  elapsed?: number;
  nextIndex?: number;
  dwellUntil?: number;
  defer?: boolean;
}

export class Service {
  readonly controls: DriverControls = { throttle: 0, brake: 1, doorsOpen: false };
  readonly simulation: FixedSimulation;
  readonly blocks: BlockController;
  readonly id: string;
  readonly stops: Station[];
  readonly arrivals: { stationOsmId: number; elapsed: number; error: number }[] = [];
  state: TrainState;
  nextIndex = 1;
  automatic = false;
  stoppingError: number | null = null;
  arrivalTime: number | null = null;
  emergencyStops = 0;
  private dwellUntil = 0;
  private discomfort = 0;
  private movingTime = 0;
  private spanIndex = 0;
  private referenceOffset = 0;
  reversals = 0;

  readonly data: ServiceData;
  readonly rail: Rail;

  constructor(data: ServiceData, rail: Rail, start: StartState = {}) {
    this.id = start.id ?? 'player';
    this.data = data;
    this.rail = rail;
    const bySource = new Map(data.stations.map(station => [station.osmId, station]));
    const calls = data.timetable?.calls?.map(call => {
      const station = bySource.get(call.stationOsmId);
      if (!station) throw new Error(`A scheduled call is missing station ${call.stationOsmId}`);
      return station;
    });
    this.stops = [...(calls ?? data.stations)];
    const last = this.stops.length - 1;
    if (last < 1) throw new Error('A service requires at least two calls');
    this.stops[last] = {
      ...this.stops[last],
      stopDistance: Math.min(this.stops[last].stopDistance, rail.length - trainFront),
    };
    this.state = {
      distance: start.distance ?? this.stops[0].stopDistance,
      speed: start.speed ?? 0,
      acceleration: 0,
      elapsed: start.elapsed ?? 0,
    };
    this.nextIndex = start.nextIndex ?? 1;
    this.dwellUntil = start.dwellUntil ?? 0;
    this.reversals = this.stops.slice(0, this.nextIndex).filter(station => station.reversal).length;
    this.simulation = new FixedSimulation(this.state);
    const boundaries = data.features
      .filter(feature => feature.type === 'signal' && feature.chainage !== undefined)
      .map(feature => feature.chainage!);
    this.blocks = start.blocks ?? new BlockController(rail.length, boundaries);
    if (!start.blocks) this.blocks.protectSharedTrack(data.spans);
    if (!start.defer && !this.activate()) throw new Error('The departure block is occupied');
  }

  chainage(distance = this.state.distance): number {
    return distance + this.referenceOffset;
  }

  activate(): boolean {
    return this.moveFootprint(this.chainage());
  }

  get nextStop(): Station | undefined {
    return this.stops[this.nextIndex];
  }

  get authority(): BlockAuthority {
    return this.blocks.aspect(this.id, this.chainage() + trainFront);
  }

  get trackSpan(): TrackSpan {
    return this.data.spans[this.spanIndex];
  }

  score(scheduledRunSeconds: number): number | null {
    if (this.nextStop || this.arrivalTime === null || this.stoppingError === null) return null;
    const timing = Math.max(0, 1 - Math.abs(this.arrivalTime - scheduledRunSeconds) / 90);
    const stopping = Math.max(0, 1 - Math.abs(this.stoppingError) / 7);
    const comfort = Math.max(0, 1 - this.discomfort / Math.max(0.1, this.movingTime));
    return Math.round(timing * 35 + stopping * 35 + comfort * 30);
  }

  toggleDoors(): boolean {
    if (this.state.speed > 0.02) return false;
    this.controls.doorsOpen = !this.controls.doorsOpen;
    return true;
  }

  tick(seconds: number): TrainState {
    this.state = this.simulation.advance(seconds, (state) => {
      const reference = this.chainage(state.distance);
      this.updateSpan(reference);
      const target = this.nextStop;
      const remaining = target ? target.stopDistance - reference : 0;
      const gradient = this.rail.gradient(reference);
      const authority = this.blocks.aspect(this.id, reference + trainFront);
      const trackEnd = this.rail.length - trainFront;
      const available = Math.min(trackEnd - reference, authority.stopDistance === null
        ? Infinity : authority.stopDistance - reference - trainFront);
      if (this.automatic) this.updateAutomatic(state, reference, remaining, available, gradient);
      const safetyBrake = available < state.speed ** 2 / 0.94 + state.speed * 1.9 + 1;
      const controls = safetyBrake ? { ...this.controls, throttle: 0, brake: 1 } : this.controls;
      if (target && this.controls.doorsOpen && Math.abs(remaining) <= 7 && state.speed < 0.03) {
        this.stoppingError = remaining;
        this.arrivalTime = state.elapsed;
        this.arrivals.push({ stationOsmId: target.osmId, elapsed: state.elapsed, error: remaining });
        const timetable = this.data.timetable;
        const scheduled = timetable?.calls?.[this.nextIndex];
        const waitUntil = scheduled
          ? timetableSeconds(scheduled.departure) - timetableSeconds(timetable.departure) : 0;
        if (target.reversal && this.nextIndex + 1 < this.stops.length) {
          this.referenceOffset += lastCoachOffset + 2 * remaining;
          this.reversals++;
        }
        this.nextIndex++;
        this.dwellUntil = Math.max(state.elapsed + 15, waitUntil);
      }
      const next = stepTrain(state, controls, gradient);
      if (this.chainage(next.distance) > trackEnd) {
        this.emergencyStops++;
        next.distance = trackEnd - this.referenceOffset;
        next.speed = 0;
      }
      if (!this.moveFootprint(this.chainage(next.distance))) {
        if (state.speed > 0) this.emergencyStops++;
        return { ...state, speed: 0, acceleration: 0, elapsed: next.elapsed };
      }
      if (next.speed >= 0.1 && this.nextStop) {
        const jerk = Math.abs(next.acceleration - state.acceleration) / STEP;
        this.discomfort += STEP * (Math.max(0, Math.abs(next.acceleration) - 0.65)
          + Math.max(0, jerk - 0.35));
        this.movingTime += STEP;
      }
      return next;
    });
    return this.state;
  }

  private moveFootprint(distance: number): boolean {
    return this.blocks.move({ id: this.id, front: distance + trainFront, rear: distance - trainRear });
  }

  private updateSpan(distance: number): void {
    while (this.spanIndex + 1 < this.data.spans.length && distance >= this.trackSpan.end) {
      this.spanIndex++;
    }
  }

  private updateAutomatic(state: TrainState, reference: number, stationDistance: number, authorityDistance: number, gradient: number): void {
    if (!this.nextStop || state.elapsed < this.dwellUntil) {
      this.controls.throttle = 0;
      this.controls.brake = 1;
      return;
    }
    if (stationDistance <= 5 && stationDistance >= -7 && state.speed < 0.0005) {
      this.controls.doorsOpen = true;
      this.controls.brake = 1;
      return;
    }
    this.controls.doorsOpen = false;
    const remaining = Math.min(stationDistance, authorityDistance);
    let limit = (this.trackSpan.speedLimit ?? 70) / 3.6;
    for (let index = this.spanIndex + 1; index < this.data.spans.length; index++) {
      const next = this.data.spans[index];
      const gap = next.start - reference;
      if (gap > 1800) break;
      const nextLimit = (next.speedLimit ?? 70) / 3.6;
      limit = Math.min(limit, Math.sqrt(nextLimit ** 2 + 2 * 0.48 * Math.max(0, gap - 15)));
    }
    const speedForStop = Math.sqrt(Math.max(0, 2 * 0.33 * (remaining - 2)));
    const target = Math.min(limit - 0.8, speedForStop);
    const terminalSpeed = Math.min(2.3, Math.max(0, (remaining - 2) * 0.28));
    const acceleration = remaining < 14
      ? (terminalSpeed - state.speed) * 0.85
      : (target - state.speed) * 0.50;
    applyAcceleration(this.controls, state.speed, gradient, acceleration);
  }
}
