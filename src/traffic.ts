import type { Rail } from './rail';
import { Service } from './service.ts';
import type { ServiceData } from './network';
import { timetableSeconds } from './world-data.ts';
import type { Timetable } from './world-data';

interface ScheduledTrain {
  trip: Timetable;
  departure: number;
  arrival: number;
  status: 'pending' | 'running' | 'done';
  service?: Service;
}

export class Traffic {
  private readonly entries: ScheduledTrain[];
  private readonly zeroTime: number;
  private readonly player: Service;
  private readonly data: ServiceData;
  private readonly rail: Rail;
  private lastClockSecond = -1;
  private running: Service[] = [];
  departures = 0;
  emergencyStops = 0;

  constructor(data: ServiceData, rail: Rail, player: Service, trips: Timetable[]) {
    this.zeroTime = timetableSeconds(data.timetable?.departure ?? '00:00');
    this.player = player;
    this.data = data;
    this.rail = rail;
    this.entries = trips.filter(item => item.trip !== data.timetable?.trip && item.calls?.length)
      .map<ScheduledTrain>(trip => ({
        trip,
        departure: timetableSeconds(trip.departure),
        arrival: timetableSeconds(trip.arrival),
        status: 'pending',
      }))
      .filter(entry => entry.arrival >= this.zeroTime);
  }

  get active(): readonly Service[] {
    return this.running;
  }

  update(elapsed: number, rateSeconds: number): void {
    const clock = this.zeroTime + elapsed;
    const clockSecond = Math.floor(clock);
    if (clockSecond !== this.lastClockSecond) {
      this.lastClockSecond = clockSecond;
      for (const train of this.entries) {
        if (train.status !== 'pending' || clock < train.departure) continue;
        const service = this.make(train, clock);
        if (!service) {
          train.status = 'done';
        } else if (service.activate()) {
          service.automatic = true;
          train.status = 'running';
          train.service = service;
          this.running.push(service);
          this.departures++;
        }
      }
    }

    for (const service of this.running) {
      service.tick(rateSeconds);
      if (!service.nextStop && service.arrivalTime !== null && service.state.elapsed > service.arrivalTime + 45) {
        const entry = this.entries.find(train => train.service === service)!;
        entry.status = 'done';
        this.emergencyStops += service.emergencyStops;
        service.blocks.remove(service.id);
        this.running = this.running.filter(candidate => candidate !== service);
      }
    }
  }

  private make(train: ScheduledTrain, clock: number): Service | undefined {
    const data = { ...this.data, timetable: train.trip };
    const start = { id: train.trip.trip, blocks: this.player.blocks, defer: true };
    if (train.departure >= this.zeroTime) return new Service(data, this.rail, start);

    const calls = train.trip.calls!;
    const index = calls.findIndex(call => timetableSeconds(call.arrival) > clock);
    if (index < 1) return undefined;
    const from = calls[index - 1];
    const to = calls[index];
    const leave = timetableSeconds(from.departure);
    const approach = timetableSeconds(to.arrival);
    const fraction = Math.max(0, Math.min(1, (clock - leave) / Math.max(1, approach - leave)));
    const positions = new Map(this.data.stations.map(station => [station.osmId, station.stopDistance]));
    const beginning = positions.get(from.stationOsmId);
    const end = positions.get(to.stationOsmId);
    if (beginning === undefined || end === undefined) return undefined;
    const distance = beginning + (end - beginning) * fraction;
    const speed = fraction <= 0 ? 0 : Math.min(29, (end - beginning) / Math.max(1, approach - leave));
    return new Service(data, this.rail, {
      ...start,
      nextIndex: index,
      distance,
      speed,
      elapsed: clock - train.departure,
      dwellUntil: Math.max(0, leave - train.departure),
    });
  }
}
