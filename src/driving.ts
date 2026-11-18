import type { SignalAspect } from './blocks';
import { SERVICE_DECELERATION, fullTraction, resistance } from './dynamics.ts';
import type { DriverControls, TrainState, RailSurface } from './dynamics';

export const PLATFORM_TOLERANCE = 7;
export const STOPPED_SPEED = 0.0005;

export interface SignalPreview {
  label: string;
  distance: number;
  aspect: SignalAspect;
}

export interface SpeedPreview {
  limit: number;
  distance: number;
}

export interface BrakingGuidance {
  target: 'line' | 'station' | 'speed change' | 'signal';
  recommendedSpeed: number;
  powerNotch: number;
  brakeNotch: number;
}

export interface DrivingPreview {
  signal?: SignalPreview;
  speedChange?: SpeedPreview;
  guidance: BrakingGuidance;
}

export interface GuidanceInput {
  state: TrainState;
  gradient: number;
  brakeGrip: number;
  tractionGrip: number;
  currentLimit: number;
  stopDistance: number;
  signalDistance: number;
  restrictions: SpeedPreview[];
}

function approachSpeed(distance: number, finalSpeed: number, deceleration: number): number {
  const reaction = 1.55 * deceleration;
  return Math.max(finalSpeed, Math.sqrt(reaction ** 2 + finalSpeed ** 2
    + 2 * deceleration * Math.max(0, distance)) - reaction);
}

export function brakingGuidance(input: GuidanceInput): BrakingGuidance {
  const { state, gradient, brakeGrip, tractionGrip, stopDistance, signalDistance, restrictions } = input;
  const slope = gradient * 9.81;
  const serviceBrake = SERVICE_DECELERATION * brakeGrip;
  const comfortable = Math.max(0.14, 0.33 * brakeGrip + slope);
  let recommended = Math.max(0, input.currentLimit - 3) / 3.6;
  let target: BrakingGuidance['target'] = 'line';

  function constrain(speed: number, reason: BrakingGuidance['target']): void {
    if (speed >= recommended) return;
    recommended = speed;
    target = reason;
  }

  if (Number.isFinite(stopDistance)) {
    const curve = approachSpeed(stopDistance - 2, 0, comfortable);
    const crawl = Math.max(0.53, (stopDistance - 2) * 0.16);
    constrain(stopDistance <= 2.6 ? 0 : Math.min(Math.max(0.53, curve), crawl), 'station');
  }
  if (Number.isFinite(signalDistance)) {
    constrain(approachSpeed(signalDistance - 8, 0, comfortable), 'signal');
  }
  for (const restriction of restrictions) {
    const entrySpeed = Math.max(0, restriction.limit - 3) / 3.6;
    constrain(approachSpeed(restriction.distance - 12, entrySpeed, comfortable), 'speed change');
  }

  if (recommended === 0) {
    return { target, recommendedSpeed: 0, powerNotch: 0, brakeNotch: 5 };
  }
  const projected = Math.max(0, state.speed + 0.62 * state.acceleration);
  const correction = (recommended - projected) / (recommended < 2 ? 1.3 : 2.4);
  const effort = correction + resistance(state.speed, gradient);
  const traction = fullTraction(state.speed) * tractionGrip;
  const nearPlatform = stopDistance > 20 && stopDistance <= 160 && projected >= 4.2;
  return {
    target,
    recommendedSpeed: recommended * 3.6,
    powerNotch: nearPlatform ? 0 : Math.max(0, Math.min(5, Math.round(5 * effort / traction))),
    brakeNotch: Math.max(0, Math.min(5, Math.round(-5 * effort / serviceBrake))),
  };
}

export interface StopResult {
  stationOsmId: number;
  station: string;
  elapsed: number;
  stoppingError: number;
  scheduleDelta: number | null;
  comfort: number;
  speedPenalty: number;
  boarded: number;
  alighted: number;
  aboard: number;
  score: number;
}

export interface Boarding {
  station: string;
  boarded: number;
  alighted: number;
  aboard: number;
  endsAt: number;
}

export interface FinalResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  stops: number;
  passengersCarried: number;
}

export function fareCounts(osmId: number, aboard: number, terminal: boolean): Pick<Boarding, 'aboard' | 'boarded' | 'alighted'> {
  const count = Math.abs(osmId);
  const alighted = terminal ? aboard : Math.min(aboard, 2 + count % 6);
  const boarded = terminal ? 0 : 3 + Math.floor(count / 8) % 9;
  return { alighted, boarded, aboard: aboard + boarded - alighted };
}

export function scoreStop(result: Omit<StopResult, 'score'>): StopResult {
  const scheduleScore = result.scheduleDelta === null ? 1
    : Math.max(0, 1 - Math.max(0, Math.abs(result.scheduleDelta) - 12) / 150);
  const stoppingScore = Math.max(0, 1 - Math.max(0, Math.abs(result.stoppingError) - 1) / (PLATFORM_TOLERANCE - 1));
  return {
    ...result,
    score: Math.round(Math.max(0, 40 * stoppingScore + 30 * scheduleScore
      + 30 * result.comfort - result.speedPenalty)),
  };
}

export function scoreRun(stops: readonly StopResult[], emergencies: number, departureLoad: number): FinalResult {
  const average = stops.reduce((sum, stop) => sum + stop.score, 0) / Math.max(1, stops.length);
  const score = Math.max(0, Math.round(average - emergencies * 10));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'E';
  return {
    score,
    grade,
    stops: stops.length,
    passengersCarried: stops.reduce((sum, stop) => sum + stop.boarded, departureLoad),
  };
}

export interface TutorialStep {
  title: string;
  prompt: string;
}

const tutorial: readonly TutorialStep[] = [
  { title: 'Release the brake', prompt: 'Press Q five times to bring Brake to 0.' },
  { title: 'Move off', prompt: 'Press W three times. Wait for the train to reach 12 km/h.' },
  { title: 'Feel the train coast', prompt: 'Press S until Power reads 0, then coast for two seconds.' },
  { title: 'Come to a stop', prompt: 'Press E three times and wait for the train to stop.' },
  { title: 'Operate the doors', prompt: 'Press D to open the doors. On the service, stop by the amber marker before opening.' },
  { title: 'See the train from outside', prompt: 'Press D to close the doors, then 2 for the chase camera.' },
  { title: 'Ready for Evanger–Voss', prompt: 'Press R to return to the platform and begin the run.' },
];

export class DrivingTutorial {
  index = 0;
  private coastingSince: number | null = null;

  get step(): TutorialStep { return tutorial[this.index]; }
  get totalSteps(): number { return tutorial.length - 1; }
  get done(): boolean { return this.index === this.totalSteps; }

  update(controls: DriverControls, state: TrainState, view: 'cab' | 'chase' | 'map'): void {
    if (this.index === 2) {
      this.coastingSince = controls.throttle === 0 && controls.brake === 0
        ? this.coastingSince ?? state.elapsed : null;
    }
    const goals = [
      controls.brake === 0,
      controls.throttle >= 0.6 && state.speed >= 12 / 3.6,
      this.coastingSince !== null && state.elapsed - this.coastingSince >= 2,
      controls.brake >= 0.6 && state.speed <= STOPPED_SPEED,
      controls.doorsOpen,
      !controls.doorsOpen && view === 'chase',
    ];
    if (goals[this.index]) this.index++;
  }
}

export const surfaceNames: Record<RailSurface, string> = {
  clear: 'Dry rail', rain: 'Wet rail', snow: 'Snow on rail',
};
