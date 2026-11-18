import assert from 'node:assert/strict';
import test from 'node:test';
import { ShowpiecePanel } from '../src/showpiece-ui.ts';

test('a stopped train anywhere in the next platform zone receives the door cue', t => {
  const previous = globalThis.document;
  const elements = new Map();
  globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {} });
    return elements.get(id);
  } };
  t.after(() => { globalThis.document = previous; });
  const panel = new ShowpiecePanel();
  const service = {
    preview: { guidance: { target: 'station', recommendedSpeed: 2, powerNotch: 3, brakeNotch: 0 } },
    state: { speed: 0 }, controls: { doorsOpen: false },
    nextStop: { stopDistance: 100 }, chainage: () => 97,
    canOpenDoors: true, boardingRemaining: 0, passengersAboard: 0, stopResults: [],
  };
  panel.update(service, 'clear');
  assert.match(elements.get('brake-cue').textContent, /D to open doors/);
  service.nextStop = { stopDistance: 150 };
  panel.update(service, 'clear');
  assert.match(elements.get('brake-cue').textContent, /Power 3/);
  service.nextStop = { stopDistance: 100 };
  service.canOpenDoors = false;
  panel.update(service, 'clear');
  assert.match(elements.get('brake-cue').textContent, /Power 3/);
  service.nextStop = undefined;
  service.controls.doorsOpen = true;
  panel.update(service, 'clear');
  assert.match(elements.get('brake-cue').textContent, /D to close doors/);
  service.controls.doorsOpen = false;
  panel.update(service, 'clear');
  assert.match(elements.get('brake-cue').textContent, /R to retry/);
});
