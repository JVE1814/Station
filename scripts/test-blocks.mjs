import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockController } from '../src/blocks.ts';

test('constructs ordered blocks at supplied signal chainages and at route ends', () => {
  const track = new BlockController(1200, [850, 150, 0, 850, 1200]);
  assert.deepEqual(track.boundaries, [0, 150, 850, 1200]);
  assert.throws(() => new BlockController(1200, [1201]), RangeError);
});

test('displays approach then stop before a leading train and clears when its rear passes', () => {
  const track = new BlockController(1200, [250, 500, 750]);
  assert.ok(track.move({ id: 'lead', rear: 620, front: 710 }));
  assert.ok(track.move({ id: 'player', rear: 100, front: 190 }));
  assert.deepEqual(track.aspect('player', 190), {
    aspect: 'approach', boundary: 250, stopDistance: 495, blockIndex: 1,
  });
  assert.ok(track.move({ id: 'player', rear: 390, front: 480 }));
  assert.deepEqual(track.aspect('player', 480), {
    aspect: 'stop', boundary: 500, stopDistance: 495, blockIndex: 2,
  });
  assert.ok(track.move({ id: 'lead', rear: 730, front: 820 }));
  assert.equal(track.aspect('player', 480).aspect, 'stop');
  assert.ok(track.move({ id: 'lead', rear: 760, front: 850 }));
  assert.equal(track.aspect('player', 480).aspect, 'approach');
  assert.ok(track.move({ id: 'lead', rear: 1201, front: 1291 }));
  assert.equal(track.aspect('player', 480).aspect, 'clear');
});

test('rejects conflicting reservations without granting any part of a request', () => {
  const track = new BlockController(500, [100, 200, 300]);
  assert.ok(track.reserve('lead', 2));
  assert.equal(track.reserve('player', 1, 2), false);
  assert.ok(track.reserve('other', 1));
  assert.equal(track.reserve('player', 2), false);
  assert.ok(track.move({ id: 'lead', rear: 205, front: 285 }));
  track.release('lead', 2);
  assert.equal(track.reserve('player', 2), false);
  assert.ok(track.move({ id: 'lead', rear: 305, front: 385 }));
  assert.ok(track.reserve('player', 2));
});

test('prevents tunnelling through an occupied or reserved block on a large update', () => {
  const track = new BlockController(1000, [200, 400, 600, 800]);
  assert.ok(track.move({ id: 'player', rear: 70, front: 160 }));
  assert.ok(track.move({ id: 'opposing', rear: 530, front: 450 }));
  assert.equal(track.move({ id: 'player', rear: 720, front: 810 }), false);
  assert.equal(track.reserve('opposing', 0), false);
  assert.ok(track.reserve('player', 3));
  assert.equal(track.move({ id: 'opposing', rear: 730, front: 650 }), false);
});

test('reports authority and retains shared protection for opposing moves', () => {
  const track = new BlockController(1000, [200, 500, 800]);
  assert.ok(track.move({ id: 'up', rear: 250, front: 340 }));
  assert.ok(track.move({ id: 'down', rear: 830, front: 740 }));
  assert.deepEqual(track.aspect('down', 740, -1), {
    aspect: 'stop', boundary: 500, stopDistance: 505, blockIndex: 1,
  });
  assert.equal(track.move({ id: 'down', rear: 560, front: 470 }), false);
  assert.equal(track.move({ id: 'up', rear: 430, front: 520 }), false);
});

test('opposing passages through the same mapped track share one physical lock', () => {
  const blocks = new BlockController(400, [100, 200, 300]);
  blocks.protectSharedTrack([
    { start: 120, end: 170, osmWay: 77 },
    { start: 230, end: 280, osmWay: 77 },
  ]);
  assert.ok(blocks.move({ id: 'arriving', rear: 135, front: 170 }));
  assert.equal(blocks.move({ id: 'returning', rear: 245, front: 265 }), false);
  assert.ok(blocks.move({ id: 'arriving', rear: 310, front: 360 }));
  assert.ok(blocks.move({ id: 'returning', rear: 245, front: 265 }));
});
