import test from 'node:test';
import assert from 'node:assert/strict';
import { CabEffort, COMFORT_JERK, STEP, railGrip, stepTrain } from '../src/dynamics.ts';
import { DrivingTutorial } from '../src/driving.ts';
import { Rail } from '../src/rail.ts';
import { Service } from '../src/service.ts';

const rail = new Rail([
  { distance: 0, east: 0, north: 0, height: 50 },
  { distance: 2000, east: 0, north: 2000, height: 68 },
  { distance: 4000, east: 0, north: 4000, height: 44 },
  { distance: 6300, east: 0, north: 6300, height: 52 },
]);

const stations = [
  { osmId: 101, name: 'Departure', stopDistance: 100 },
  { osmId: 102, name: 'Halt', stopDistance: 2100 },
  { osmId: 103, name: 'Station', stopDistance: 4000 },
  { osmId: 104, name: 'Terminus', stopDistance: 6200 },
];
const data = {
  service: 'R40',
  stations,
  spans: [
    { start: 0, end: 1000, speedLimit: 95, osmWay: 1 },
    { start: 1000, end: 2100, speedLimit: 55, osmWay: 2 },
    { start: 2100, end: 4300, speedLimit: 85, osmWay: 3 },
    { start: 4300, end: 6300, speedLimit: 60, osmWay: 4 },
  ],
  features: [
    { type: 'signal', chainage: 210, facesService: false, tags: { ref: 'Opposing' } },
    { type: 'signal', chainage: 900, facesService: true, tags: { ref: 'A' } },
    { type: 'signal', chainage: 1900, facesService: true, tags: { ref: 'B' } },
  ],
  timetable: {
    departure: '08:00:00', arrival: '08:10:30',
    calls: [
      { stationOsmId: 101, arrival: '08:00:00', departure: '08:00:00' },
      { stationOsmId: 102, arrival: '08:02:30', departure: '08:02:45' },
      { stationOsmId: 103, arrival: '08:05:15', departure: '08:05:30' },
      { stationOsmId: 104, arrival: '08:08:15', departure: '08:08:15' },
    ],
  },
};

test('controller notches and applied brake and traction are separate', () => {
  const service = new Service(data, rail, { driving: true });
  for (let i = 0; i < 7; i++) service.adjustNotch('brake', -0.2);
  for (let i = 0; i < 3; i++) service.adjustNotch('throttle', 0.2);
  assert.deepEqual(service.controls, { throttle: 0.6, brake: 0, doorsOpen: false });
  service.tick(0.05);
  assert.equal(service.effort.throttle, 0);
  assert.ok(service.effort.brake > 0.8);
  assert.equal(service.state.speed, 0);
  service.tick(0.8);
  assert.ok(service.effort.throttle > 0 && service.effort.throttle < service.controls.throttle);
  service.tick(1);
  assert.equal(service.effort.throttle, 0.6);
  assert.equal(service.effort.brake, 0);
  assert.ok(service.state.speed > 0);

  const pipe = new CabEffort();
  for (let i = 0; i < 150; i++) pipe.update({ throttle: 1, brake: 0, doorsOpen: false }, false);
  const applying = pipe.update({ throttle: 1, brake: 1, doorsOpen: false }, false);
  assert.ok(applying.brake > 0 && applying.brake < 0.1);
});

test('wet and snowy rail reduce available traction and lengthen braking', () => {
  const starting = { distance: 0, speed: 15, acceleration: 0, elapsed: 0 };
  const glide = (surface, throttle, brake, duration) => {
    let state = starting;
    for (let elapsed = 0; elapsed < duration; elapsed += STEP) {
      state = stepTrain(state, { throttle, brake, doorsOpen: false }, 0, railGrip[surface]);
    }
    return state;
  };
  const acceleration = ['clear', 'rain', 'snow'].map(surface => glide(surface, 1, 0, 12).speed);
  assert.ok(acceleration[0] > acceleration[1] && acceleration[1] > acceleration[2]);
  const braking = ['clear', 'rain', 'snow'].map(surface => glide(surface, 0, 1, 40).distance);
  assert.ok(braking[0] < braking[1] && braking[1] < braking[2]);
});

test('releasing stationary brakes on a falling grade respects the jerk limit', () => {
  const service = new Service(data, rail, { driving: true, distance: 3000 });
  service.surface = 'snow';
  service.adjustNotch('brake', -1);
  service.adjustNotch('throttle', 1);
  let previousAcceleration = 0;
  for (let tick = 0; tick < 100; tick++) {
    const speed = service.state.speed;
    const state = service.tick(0.05);
    const acceleration = (state.speed - speed) / 0.05;
    assert.ok(Math.abs(acceleration - previousAcceleration) / 0.05 <= COMFORT_JERK + 1e-6);
    previousAcceleration = acceleration;
  }
  assert.ok(service.state.speed > 1);
});

test('preview uses the next signal in the running direction and brakes earlier on snow', () => {
  const service = new Service(data, rail, { driving: true, distance: 600, speed: 23 });
  assert.ok(service.blocks.move({ id: 'another-train', rear: 1250, front: 1300 }));
  const clear = service.preview;
  service.surface = 'snow';
  const snow = service.preview;
  assert.equal(clear.signal.label, 'A');
  assert.equal(clear.signal.aspect, 'stop');
  assert.ok(clear.signal.distance > 280 && clear.signal.distance < 300);
  assert.deepEqual(clear.speedChange, { limit: 55, distance: 400 });
  assert.equal(clear.guidance.target, 'signal');
  assert.ok(clear.guidance.brakeNotch > 0);
  assert.ok(snow.guidance.recommendedSpeed < clear.guidance.recommendedSpeed);
});

test('advisory notches serve each stop, collect boarding results, and preserve replay safety', () => {
  for (const surface of ['clear', 'rain', 'snow']) {
    const service = new Service(data, rail, { driving: true });
    const originalPassengers = service.passengersAboard;
    service.surface = surface;
    const sample = 0.45;
    let observedStops = 0;
    for (let interval = 0; service.nextStop && interval * sample < 1100; interval++) {
      assert.equal(service.stopMissed, false);
      if (service.controls.doorsOpen) {
        if (service.boardingRemaining === 0) assert.ok(service.toggleDoors());
      } else {
        const { powerNotch, brakeNotch, recommendedSpeed } = service.preview.guidance;
        const setNotch = (control, notch) => service.adjustNotch(control, notch / 5 - service.controls[control]);
        setNotch('throttle', powerNotch);
        setNotch('brake', brakeNotch);
        if (recommendedSpeed === 0 && service.canOpenDoors) assert.ok(service.toggleDoors());
      }
      const previous = service.state;
      service.tick(sample);
      assert.ok(service.state.distance >= previous.distance);
      assert.ok(Math.abs(service.state.acceleration - previous.acceleration) / sample <= COMFORT_JERK + 1e-6);
      if (observedStops !== service.stopResults.length) {
        observedStops++;
        assert.ok(service.boardingRemaining > 0);
        assert.equal(service.toggleDoors(), false);
      }
    }
    assert.equal(service.nextStop, undefined, `${surface} rail, distance ${service.chainage()}`);
    assert.equal(service.emergencyStops, 0);
    assert.deepEqual(service.stopResults.map(stop => stop.station), ['Halt', 'Station', 'Terminus']);
    assert.ok(service.stopResults.every(stop => Math.abs(stop.stoppingError) < 4));
    assert.equal(service.stopResults.at(-1).aboard, 0);
    assert.equal(service.finalResult.passengersCarried,
      service.stopResults.reduce((total, stop) => total + stop.boarded, originalPassengers));
    assert.equal(service.finalResult.stops, 3);
    assert.ok(service.finalResult.score >= 65);
    assert.equal(new Service(data, rail, { driving: true }).stopResults.length, 0);
  }
});

test('tutorial progresses through real braking, coasting, doors and view controls', () => {
  const service = new Service(data, rail, { driving: true, training: true });
  const tutorial = new DrivingTutorial();
  const step = view => {
    service.tick(0.05);
    tutorial.update(service.controls, service.state, view ?? 'cab');
  };
  function waitForIndex(index) {
    for (let i = 0; tutorial.index < index && i < 400; i++) step();
    assert.equal(tutorial.index, index);
  }
  for (let i = 0; i < 5; i++) service.adjustNotch('brake', -0.2);
  waitForIndex(1);
  for (let i = 0; i < 3; i++) service.adjustNotch('throttle', 0.2);
  waitForIndex(2);
  for (let i = 0; i < 3; i++) service.adjustNotch('throttle', -0.2);
  waitForIndex(3);
  for (let i = 0; i < 3; i++) service.adjustNotch('brake', 0.2);
  waitForIndex(4);
  assert.ok(service.toggleDoors());
  waitForIndex(5);
  assert.ok(service.toggleDoors());
  step('chase');
  assert.ok(tutorial.done);
  assert.ok(service.state.elapsed < 60);
  assert.deepEqual(service.stopResults, []);
});
