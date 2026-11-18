export const STEP = 1 / 120;
export const SERVICE_DECELERATION = 0.95;
export const COMFORT_JERK = 0.55;

export interface TrainState {
  distance: number;
  speed: number;
  acceleration: number;
  elapsed: number;
}

export interface DriverControls {
  throttle: number;
  brake: number;
  doorsOpen: boolean;
}

export type RailSurface = 'clear' | 'rain' | 'snow';

interface Grip {
  traction: number;
  brake: number;
}

const dryGrip: Grip = { traction: 1, brake: 1 };
export const railGrip: Record<RailSurface, Grip> = {
  clear: dryGrip,
  rain: { traction: 0.82, brake: 0.83 },
  snow: { traction: 0.61, brake: 0.67 },
};

function ramp(value: number, target: number, rise: number, fall: number): number {
  return Math.max(value - STEP / fall, Math.min(value + STEP / rise, target));
}

/** Traction demand and the brake pipe settle separately from controller positions. */
export class CabEffort {
  readonly applied: DriverControls = { throttle: 0, brake: 1, doorsOpen: false };

  update(command: DriverControls, direct: boolean): DriverControls {
    const applied = this.applied;
    applied.brake = direct ? command.brake : ramp(applied.brake, command.brake, 0.82, 0.65);
    applied.throttle = (command.doorsOpen || applied.brake > 0) ? 0
      : direct ? command.throttle : ramp(applied.throttle, command.throttle, 1.15, 0.5);
    applied.doorsOpen = command.doorsOpen;
    return applied;
  }
}

export function fullTraction(speed: number): number {
  return 0.8 / (1 + speed / 32);
}

export function resistance(speed: number, gradient: number): number {
  return 0.012 + speed ** 2 * 0.000019 + 9.81 * gradient;
}

export function applyAcceleration(
  controls: DriverControls,
  speed: number,
  gradient: number,
  acceleration: number,
  grip = dryGrip,
): void {
  const effort = acceleration + resistance(speed, gradient);
  controls.throttle = Math.max(0, Math.min(1, effort / (fullTraction(speed) * grip.traction)));
  controls.brake = Math.max(0, Math.min(1, -effort / (SERVICE_DECELERATION * grip.brake)));
}

export function stepTrain(
  state: TrainState,
  controls: DriverControls,
  gradient: number,
  grip = dryGrip,
): TrainState {
  const traction = controls.brake > 0 || controls.doorsOpen
    ? 0
    : controls.throttle * fullTraction(state.speed) * grip.traction;
  const effort = traction - controls.brake * SERVICE_DECELERATION * grip.brake - resistance(state.speed, gradient);
  const jerkStep = COMFORT_JERK * STEP;
  const held = controls.doorsOpen || (state.speed === 0 && controls.brake > 0);
  // Preserve enough speed to release the remaining deceleration before standstill.
  const stoppingEnvelope = jerkStep - Math.sqrt(jerkStep ** 2 + 2 * COMFORT_JERK * state.speed);
  const target = held && state.speed === 0 ? 0 : Math.max(effort, stoppingEnvelope);
  const acceleration = Math.min(
    state.acceleration + jerkStep,
    Math.max(state.acceleration - jerkStep, target),
  );
  const speed = held ? 0 : Math.max(0, state.speed + acceleration * STEP);
  return {
    distance: state.distance + (state.speed + speed) * STEP * 0.5,
    speed,
    acceleration,
    elapsed: state.elapsed + STEP,
  };
}

export class FixedSimulation {
  private remainder = 0;
  private previous: TrainState;
  private current: TrainState;

  constructor(initial: TrainState) {
    this.current = initial;
    this.previous = initial;
  }

  advance(seconds: number, update: (state: TrainState) => TrainState): TrainState {
    this.remainder += seconds;
    while (this.remainder >= STEP) {
      this.previous = this.current;
      this.current = update(this.current);
      this.remainder -= STEP;
    }
    const alpha = this.remainder / STEP;
    const lerp = (key: keyof TrainState) =>
      this.previous[key] + (this.current[key] - this.previous[key]) * alpha;
    return {
      distance: lerp('distance'),
      speed: lerp('speed'),
      acceleration: lerp('acceleration'),
      elapsed: lerp('elapsed'),
    };
  }
}
