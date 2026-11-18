import { STEP, FixedSimulation, applyAcceleration, stepTrain } from './dynamics.ts';
import type { DriverControls, TrainState } from './dynamics.ts';
import type { Rail } from './rail';
import type { Station, TrackSpan, WorldData } from './world-data';

export class Service {
  readonly controls: DriverControls = { throttle: 0, brake: 1, doorsOpen: false };
  readonly simulation: FixedSimulation;
  state: TrainState;
  nextIndex = 1;
  automatic = false;
  stoppingError: number | null = null;
  arrivalTime: number | null = null;
  private dwellUntil = 0;
  private discomfort = 0;
  private movingTime = 0;
  private spanIndex = 0;

  readonly data: WorldData;
  readonly rail: Rail;

  constructor(data: WorldData, rail: Rail) {
    this.data = data;
    this.rail = rail;
    this.state = { distance: data.stations[0].stopDistance, speed: 0, acceleration: 0, elapsed: 0 };
    this.simulation = new FixedSimulation(this.state);
  }

  get nextStop(): Station | undefined {
    return this.data.stations[this.nextIndex];
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
      this.updateSpan(state.distance);
      const target = this.nextStop;
      const remaining = target ? target.stopDistance - state.distance : 0;
      const gradient = this.rail.gradient(state.distance);
      if (this.automatic) this.updateAutomatic(state, remaining, gradient);
      if (target && this.controls.doorsOpen && Math.abs(remaining) <= 7 && state.speed < 0.03) {
        this.stoppingError = remaining;
        this.arrivalTime = state.elapsed;
        this.nextIndex++;
        this.dwellUntil = state.elapsed + 15;
      }
      const next = stepTrain(state, this.controls, gradient);
      if (next.speed >= 0.1 && this.nextStop) {
        const jerk = Math.abs(next.acceleration - state.acceleration) / STEP;
        this.discomfort += STEP * (Math.max(0, Math.abs(next.acceleration) - 0.65)
          + Math.max(0, jerk - 0.35));
        this.movingTime += STEP;
      }
      if (next.distance >= this.rail.length) {
        next.distance = this.rail.length;
        next.speed = 0;
      }
      return next;
    });
    return this.state;
  }

  private updateSpan(distance: number): void {
    while (this.spanIndex + 1 < this.data.spans.length && distance >= this.trackSpan.end) {
      this.spanIndex++;
    }
  }

  private updateAutomatic(state: TrainState, remaining: number, gradient: number): void {
    if (!this.nextStop || state.elapsed < this.dwellUntil) {
      this.controls.throttle = 0;
      this.controls.brake = 1;
      return;
    }
    if (remaining <= 5 && state.speed < 0.03) {
      this.controls.doorsOpen = true;
      this.controls.brake = 1;
      return;
    }
    this.controls.doorsOpen = false;
    let limit = (this.trackSpan.speedLimit ?? 70) / 3.6;
    for (let index = this.spanIndex + 1; index < this.data.spans.length; index++) {
      const next = this.data.spans[index];
      const gap = next.start - state.distance;
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
