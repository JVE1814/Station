export type SignalAspect = 'clear' | 'approach' | 'stop';

export interface BlockAuthority {
  aspect: SignalAspect;
  boundary: number | null;
  stopDistance: number | null;
  blockIndex: number | null;
}

export interface TrainFootprint {
  id: string;
  front: number;
  rear: number;
}

interface Block {
  indices: number[];
  occupied?: string;
  reserved?: string;
}

const SIGNAL_MARGIN = 5;

/** Single shared alignment. Chainage is in metres and increases with the reference service. */
export class BlockController {
  readonly boundaries: readonly number[];
  private readonly blocks: Block[];
  private readonly trains = new Map<string, TrainFootprint>();
  private readonly locked = new Set<Block>();

  constructor(length: number, signalChainages: readonly number[]) {
    if (!Number.isFinite(length) || length <= 0) {
      throw new RangeError('Block alignment length must be positive and finite');
    }
    if (signalChainages.some(chainage => !Number.isFinite(chainage) || chainage < 0 || chainage > length)) {
      throw new RangeError('Signal chainages must lie within the block alignment');
    }
    this.boundaries = Object.freeze([...new Set([0, ...signalChainages, length])].sort((a, b) => a - b));
    this.blocks = Array.from({ length: this.boundaries.length - 1 }, (_, index) => ({ indices: [index] }));
  }

  private blockAt(chainage: number): number {
    let low = -1;
    let high = this.boundaries.length;
    while (high - low > 1) {
      const middle = Math.floor((high + low) / 2);
      if (this.boundaries[middle] <= chainage) low = middle;
      else high = middle;
    }
    return low;
  }

  private footprintRange(positions: number[]): [first: number, last: number] {
    return [Math.max(0, this.blockAt(Math.min(...positions))), Math.min(this.blocks.length - 1, this.blockAt(Math.max(...positions)))];
  }

  private available(index: number, id: string): boolean {
    const { reserved, occupied } = this.blocks[index];
    return (reserved === undefined || reserved === id) && (occupied === undefined || occupied === id);
  }

  private updateLock(block: Block): void {
    if (block.occupied !== undefined || block.reserved !== undefined) this.locked.add(block);
    else this.locked.delete(block);
  }

  /** Tie repeated use of one physical track section to the same block lock. */
  protectSharedTrack(ranges: readonly { start: number; end: number; osmWay: number; direction?: string }[]): void {
    if (this.locked.size) throw new Error('Shared track must be defined before the first train enters');
    const firstUse = new Map<number, { start: number; end: number; direction?: string }>();
    for (const range of ranges) {
      const previous = firstUse.get(range.osmWay);
      if (!previous) {
        firstUse.set(range.osmWay, range);
        continue;
      }
      if (range.start <= previous.end + 0.1 && range.direction === previous.direction) continue;
      const [a0, a1] = this.footprintRange([previous.start, previous.end - 0.001]);
      const [b0, b1] = this.footprintRange([range.start, range.end - 0.001]);
      const shared = new Set([...this.blocks.slice(a0, a1 + 1), ...this.blocks.slice(b0, b1 + 1)]);
      const lock = this.blocks[a0];
      for (let index = 0; index < this.blocks.length; index++) {
        if (shared.has(this.blocks[index])) this.blocks[index] = lock;
      }
    }
    for (const block of new Set(this.blocks)) block.indices.length = 0;
    this.blocks.forEach((block, index) => block.indices.push(index));
  }

  remove(id: string): void {
    for (const block of this.locked) {
      if (block.occupied === id) delete block.occupied;
      if (block.reserved === id) delete block.reserved;
      this.updateLock(block);
    }
    this.trains.delete(id);
  }

  /** Acquire every requested block together, or leave all reservations unchanged. */
  reserve(id: string, ...indices: number[]): boolean {
    if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= this.blocks.length)) {
      throw new RangeError('Invalid block index');
    }
    if (indices.some(index => !this.available(index, id))) return false;
    for (const index of indices) {
      const block = this.blocks[index];
      block.reserved = id;
      this.updateLock(block);
    }
    return true;
  }

  /** Cancel a reservation. Occupancy remains protected until the train moves clear. */
  release(id: string, index: number): void {
    const block = this.blocks[index];
    if (block?.reserved !== id) return;
    delete block.reserved;
    this.updateLock(block);
  }

  /** Move the full train atomically, checking the swept path as well as its new footprint. */
  move(footprint: TrainFootprint): boolean {
    const { id, front, rear } = footprint;
    if (![front, rear].every(Number.isFinite)) throw new RangeError('Invalid train footprint');
    const previous = this.trains.get(id);
    const [first, last] = this.footprintRange(previous
      ? [front, rear, previous.front, previous.rear]
      : [front, rear]);
    for (let index = first; index <= last; index++) {
      if (!this.available(index, id)) return false;
    }
    const [firstOccupied, lastOccupied] = this.footprintRange([front, rear]);
    const newOccupancy = new Set(this.blocks.slice(firstOccupied, lastOccupied + 1));
    for (const block of new Set(this.blocks.slice(first, last + 1))) {
      if (newOccupancy.has(block)) block.occupied = id;
      else {
        if (block.occupied === id) delete block.occupied;
        if (block.reserved === id) delete block.reserved;
      }
      this.updateLock(block);
    }
    this.trains.set(id, { id, front, rear });
    return true;
  }

  /**
   * Authority at the next boundary. Approach grants the following block and
   * identifies the next closed boundary, so the driver can brake in advance.
   */
  aspect(id: string, front: number, direction: -1 | 1 = 1): BlockAuthority {
    if (!Number.isFinite(front)) throw new RangeError('Invalid lead position');
    const block = this.blockAt(front);
    const adjacent = block + direction;
    if (adjacent < 0 || adjacent >= this.blocks.length) {
      return { aspect: 'clear', boundary: null, stopDistance: null, blockIndex: null };
    }

    const entry = (index: number) => this.boundaries[index + (direction === 1 ? 0 : 1)];
    const boundary = entry(adjacent);
    let blocked = direction === 1 ? this.blocks.length : -1;
    for (const lock of this.locked) {
      if ((lock.occupied === undefined || lock.occupied === id)
        && (lock.reserved === undefined || lock.reserved === id)) continue;
      for (const index of lock.indices) {
        if ((index - adjacent) * direction >= 0 && (blocked - index) * direction > 0) blocked = index;
      }
    }
    const stopDistance = blocked >= 0 && blocked < this.blocks.length
      ? Math.max(0, Math.min(this.boundaries.at(-1)!, entry(blocked) - SIGNAL_MARGIN * direction))
      : null;
    const aspect = blocked === adjacent
      ? 'stop'
      : blocked === adjacent + direction && stopDistance !== null ? 'approach' : 'clear';
    return { aspect, boundary, stopDistance, blockIndex: adjacent };
  }
}
