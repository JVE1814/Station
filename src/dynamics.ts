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

export function stepTrain(
  state: TrainState,
  controls: DriverControls,
  gradient: number,
): TrainState {
  const traction = controls.brake > 0 || controls.doorsOpen
    ? 0
    : controls.throttle * 0.8 / (1 + state.speed / 32);
  const resistance = 0.012 + state.speed ** 2 * 0.000019;
  const target = traction - controls.brake * SERVICE_DECELERATION - resistance - 9.81 * gradient;
  const jerkStep = COMFORT_JERK * STEP;
  const acceleration = Math.min(
    state.acceleration + jerkStep,
    Math.max(state.acceleration - jerkStep, target),
  );
  const held = controls.doorsOpen || (state.speed === 0 && controls.brake > 0);
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
