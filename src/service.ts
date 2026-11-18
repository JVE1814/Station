import { BlockController } from './blocks.ts';
import type { BlockAuthority } from './blocks.ts';
import { STEP, CabEffort, FixedSimulation, applyAcceleration, railGrip, stepTrain } from './dynamics.ts';
import type { DriverControls, RailSurface, TrainState } from './dynamics.ts';
import { PLATFORM_TOLERANCE, STOPPED_SPEED, brakingGuidance, fareCounts, scoreRun, scoreStop } from './driving.ts';
import type { Boarding, DrivingPreview, FinalResult, SpeedPreview, StopResult } from './driving.ts';
import type { Rail } from './rail';
import { timetableSeconds } from './world-data.ts';
import type { Station, TrackSpan, WorldFeature } from './world-data';
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
  driving?: boolean;
  training?: boolean;
}

export class Service {
  readonly controls: DriverControls = { throttle: 0, brake: 1, doorsOpen: false };
  readonly simulation: FixedSimulation;
  readonly blocks: BlockController;
  readonly id: string;
  readonly stops: Station[];
  readonly arrivals: { stationOsmId: number; elapsed: number; error: number }[] = [];
  readonly stopResults: StopResult[] = [];
  readonly driving: boolean;
  readonly training: boolean;
  surface: RailSurface = 'clear';
  boarding: Boarding | null = null;
  finalResult: FinalResult | null = null;
  state: TrainState;
  nextIndex = 1;
  automatic = false;
  stoppingError: number | null = null;
  arrivalTime: number | null = null;
  emergencyStops = 0;
  private readonly cabEffort?: CabEffort;
  private readonly signals: WorldFeature[];
  private readonly departureLoad: number;
  private legStart = { discomfort: 0, movingTime: 0, excessSpeed: 0 };
  private passengers: number;
  private dwellUntil = 0;
  private discomfort = 0;
  private movingTime = 0;
  private excessSpeed = 0;
  private spanIndex = 0;
  private referenceOffset = 0;
  reversals = 0;

  readonly data: ServiceData;
  readonly rail: Rail;

  constructor(data: ServiceData, rail: Rail, start: StartState = {}) {
    this.id = start.id ?? 'player';
    this.data = data;
    this.rail = rail;
    this.driving = start.driving === true;
    this.training = start.training === true;
    if (this.driving) this.cabEffort = new CabEffort();
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
    this.departureLoad = this.driving ? 22 + ((this.stops[0].osmId ?? 0) % 13) : 0;
    this.passengers = this.departureLoad;
    this.dwellUntil = start.dwellUntil ?? 0;
    this.reversals = this.stops.slice(0, this.nextIndex).filter(station => station.reversal).length;
    this.simulation = new FixedSimulation(this.state);
    const signals = data.features.filter(feature => feature.type === 'signal' && feature.chainage !== undefined);
    this.signals = signals.filter(feature => feature.facesService !== false)
      .sort((first, second) => first.chainage! - second.chainage!);
    const boundaries = signals.map(feature => feature.chainage!);
    this.blocks = start.blocks ?? new BlockController(rail.length, boundaries);
    if (!start.blocks) this.blocks.protectSharedTrack(data.spans);
    this.updateSpan(this.chainage());
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

  get effort(): DriverControls {
    return this.cabEffort?.applied ?? this.controls;
  }

  get passengersAboard(): number {
    return this.passengers;
  }

  get boardingRemaining(): number {
    return this.controls.doorsOpen ? Math.max(0, (this.boarding?.endsAt ?? 0) - this.state.elapsed) : 0;
  }

  get stopMissed(): boolean {
    return !!this.nextStop && this.chainage() - this.nextStop.stopDistance > PLATFORM_TOLERANCE;
  }

  get canOpenDoors(): boolean {
    if (this.state.speed > (this.driving ? STOPPED_SPEED : 0.02)) return false;
    if (!this.driving || this.training) return true;
    const previous = this.stops[this.nextIndex - 1];
    const reference = this.chainage();
    const next = this.nextStop;
    return (previous && Math.abs(previous.stopDistance - reference) <= PLATFORM_TOLERANCE)
      || !!next && Math.abs(next.stopDistance - reference) <= PLATFORM_TOLERANCE;
  }

  get preview(): DrivingPreview {
    const reference = this.chainage();
    const front = reference + trainFront;
    const nextSignal = this.signals.find(feature => feature.chainage! > front);
    const signal = nextSignal && {
      label: nextSignal.tags.ref ?? 'Signal',
      distance: nextSignal.chainage! - front,
      aspect: this.blocks.aspect(this.id, nextSignal.chainage! - 0.01).aspect,
    };
    const currentLimit = this.trackSpan.speedLimit ?? 70;
    const restrictions: SpeedPreview[] = [];
    let speedChange: SpeedPreview | undefined;
    for (let index = this.spanIndex + 1; index < this.data.spans.length; index++) {
      const span = this.data.spans[index];
      const distance = span.start - reference;
      const limit = span.speedLimit ?? 70;
      if (limit !== currentLimit) speedChange ??= { limit, distance };
      if (distance > 1800) {
        if (speedChange) break;
      } else if (limit < currentLimit) restrictions.push({ limit, distance });
    }
    const grip = railGrip[this.surface];
    const authority = this.authority;
    const gradient = this.rail.gradient(reference);
    return {
      signal,
      speedChange,
      guidance: brakingGuidance({
        state: this.state, gradient, brakeGrip: grip.brake, tractionGrip: grip.traction, currentLimit, restrictions,
        stopDistance: (this.nextStop?.stopDistance ?? Infinity) - reference,
        signalDistance: (authority.stopDistance ?? Infinity) - front,
      }),
    };
  }

  adjustNotch(control: 'throttle' | 'brake', increment: number): void {
    this.automatic = false;
    if (this.driving && this.controls.doorsOpen) return;
    this.controls[control] = Math.max(0, Math.min(1, Math.round((this.controls[control] + increment) * 5) / 5));
  }

  private speedingBy(speed: number): number {
    const limit = this.trackSpan.speedLimit;
    return limit == null ? 0 : Math.max(0, speed * 3.6 - limit - 2);
  }

  get speeding(): boolean {
    return this.speedingBy(this.state.speed) > 0;
  }

  score(scheduledRunSeconds: number): number | null {
    if (this.nextStop || this.arrivalTime === null || this.stoppingError === null) return null;
    const timing = Math.max(0, 1 - Math.abs(this.arrivalTime - scheduledRunSeconds) / 90);
    const stopping = Math.max(0, 1 - Math.abs(this.stoppingError) / 7);
    const comfort = Math.max(0, 1 - this.discomfort / Math.max(0.1, this.movingTime));
    const speedingPenalty = Math.min(20, this.excessSpeed / 20);
    return Math.round(Math.max(0, timing * 35 + stopping * 35 + comfort * 30 - speedingPenalty));
  }

  toggleDoors(): boolean {
    if (this.controls.doorsOpen ? this.boardingRemaining > 0 : !this.canOpenDoors) return false;
    this.controls.doorsOpen = !this.controls.doorsOpen;
    if (this.driving && this.controls.doorsOpen) {
      this.controls.throttle = 0;
      this.controls.brake = 1;
    }
    return true;
  }

  tick(seconds: number): TrainState {
    this.state = this.simulation.advance(seconds, (state) => {
      const reference = this.chainage(state.distance);
      this.updateSpan(reference);
      const target = this.nextStop;
      const remaining = target ? target.stopDistance - reference : 0;
      const gradient = this.rail.gradient(reference);
      const grip = railGrip[this.driving ? this.surface : 'clear'];
      const authority = this.blocks.aspect(this.id, reference + trainFront);
      const trackEnd = this.rail.length - trainFront;
      const available = Math.min(trackEnd - reference, authority.stopDistance === null
        ? Infinity : authority.stopDistance - reference - trainFront);
      if (this.automatic) this.updateAutomatic(state, reference, remaining, available, gradient);
      const brakingMargin = this.driving ? Math.max(0.32, 0.94 * grip.brake + Math.min(0, gradient * 9.81)) : 0.94;
      const safetyBrake = available < state.speed ** 2 / brakingMargin + state.speed * 1.9 + 1;
      const command = safetyBrake ? { ...this.controls, throttle: 0, brake: 1 } : this.controls;
      const controls = this.cabEffort?.update(command, this.automatic || safetyBrake) ?? command;
      if (target && this.controls.doorsOpen && Math.abs(remaining) <= PLATFORM_TOLERANCE && state.speed < 0.03) {
        this.stoppingError = remaining;
        this.arrivalTime = state.elapsed;
        this.arrivals.push({ stationOsmId: target.osmId, elapsed: state.elapsed, error: remaining });
        const timetable = this.data.timetable;
        const scheduled = timetable?.calls?.[this.nextIndex];
        const waitUntil = scheduled
          ? timetableSeconds(scheduled.departure) - timetableSeconds(timetable.departure) : 0;
        if (this.driving && !this.training) {
          const arriving = scheduled?.arrival ?? (this.nextIndex === this.stops.length - 1 ? timetable?.arrival : undefined);
          const scheduleDelta = arriving && timetable
            ? state.elapsed + timetableSeconds(timetable.departure) - timetableSeconds(arriving) : null;
          this.recordStop(target, state.elapsed, remaining, scheduleDelta);
        }
        if (target.reversal && this.nextIndex + 1 < this.stops.length) {
          this.referenceOffset += lastCoachOffset + 2 * remaining;
          this.reversals++;
        }
        this.nextIndex++;
        this.dwellUntil = Math.max(state.elapsed + 15, waitUntil);
      }
      const next = stepTrain(state, controls, gradient, grip);
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
        this.excessSpeed += this.speedingBy(next.speed) * STEP;
      }
      return next;
    });
    return this.state;
  }

  private moveFootprint(distance: number): boolean {
    return this.blocks.move({ id: this.id, front: distance + trainFront, rear: distance - trainRear });
  }

  private recordStop(station: Station, elapsed: number, stoppingError: number, scheduleDelta: number | null): void {
    const terminal = this.nextIndex === this.stops.length - 1;
    const counts = fareCounts(station.osmId, this.passengers, terminal);
    this.passengers = counts.aboard;
    this.boarding = {
      station: station.name,
      ...counts,
      endsAt: elapsed + Math.min(14, 5 + 0.5 * (counts.boarded + counts.alighted)),
    };
    const leg = this.legStart;
    const comfort = Math.max(0, 1 - (this.discomfort - leg.discomfort) / Math.max(0.1, this.movingTime - leg.movingTime));
    const speedPenalty = Math.min(20, (this.excessSpeed - leg.excessSpeed) / 20);
    this.legStart = { discomfort: this.discomfort, movingTime: this.movingTime, excessSpeed: this.excessSpeed };
    this.stopResults.push(scoreStop({
      stationOsmId: station.osmId,
      station: station.name,
      elapsed,
      stoppingError,
      scheduleDelta,
      comfort,
      speedPenalty,
      ...counts,
    }));
    if (terminal) this.finalResult = scoreRun(this.stopResults, this.emergencyStops, this.departureLoad);
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
    const grip = railGrip[this.driving ? this.surface : 'clear'];
    let limit = (this.trackSpan.speedLimit ?? 70) / 3.6;
    for (let index = this.spanIndex + 1; index < this.data.spans.length; index++) {
      const next = this.data.spans[index];
      const gap = next.start - reference;
      if (gap > 1800) break;
      const nextLimit = (next.speedLimit ?? 70) / 3.6;
      limit = Math.min(limit, Math.sqrt(nextLimit ** 2 + 2 * 0.48 * grip.brake * Math.max(0, gap - 15)));
    }
    const speedForStop = Math.sqrt(Math.max(0, 2 * 0.33 * grip.brake * (remaining - 2)));
    const target = Math.min(limit - 0.8, speedForStop);
    const terminalSpeed = Math.min(2.3, Math.max(0, (remaining - 2) * 0.28));
    const acceleration = remaining < 14
      ? (terminalSpeed - state.speed) * 0.85
      : (target - state.speed) * 0.50;
    applyAcceleration(this.controls, state.speed, gradient, acceleration, grip);
  }
}
