import { Vector3 } from 'three';
import type { Rail } from './rail';
import type { LocalPoint, WorldData } from './world-data';

export interface StationAudioState {
  speed: number;
  distance: number;
  throttle: number;
  brake: number;
  brakeCommand?: number;
  doorsOpen: boolean;
  weather: 'clear' | 'rain' | 'snow';
  tunnel: boolean;
  bridge: boolean;
  lakeside: number;
  view: 'cab' | 'chase' | 'map';
  paused: boolean;
  timeScale: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function audioMixFor(state: StationAudioState) {
  const moving = ease(state.speed / 29);
  const crawl = ease(state.speed / 1.4);
  const power = state.doorsOpen || state.brake > 0 ? 0 : clamp(state.throttle);
  const braking = clamp(state.brake) * crawl;
  const cab = state.view === 'cab';
  const map = state.view === 'map';
  const exterior = state.tunnel ? 0.06 : 1;
  const wet = state.weather === 'rain';
  const snow = state.weather === 'snow';
  return {
    master: state.paused ? 0 : 0.76,
    train: map ? 0.17 : cab ? 0.72 : 0.94,
    cutoff: map ? 1150 : cab ? 2700 : 7400,
    tunnel: state.tunnel ? 0.78 : 0,
    equipment: (map ? 0.012 : 0.035) * (1 + (state.doorsOpen ? 0.6 : 0)),
    torque: Math.sqrt(power) * (0.118 - 0.037 * moving),
    tone: 38 + state.speed * 3.85,
    inverter: Math.sqrt(power) * (0.034 + 0.043 * (1 - ease(state.speed / 10))),
    switchRate: 189 + 52 * Math.floor(state.speed / 5) + state.speed * 2.1,
    bogie: crawl * (0.11 + 0.27 * moving + (state.bridge ? 0.12 : 0)),
    tread: crawl * (0.025 + 0.245 * moving) * (snow ? 0.68 : wet ? 1.19 : 1),
    treadPitch: 275 + state.speed * 21,
    brake: 0.18 * braking * (0.57 + 0.43 * (1 - moving)),
    squeal: 0.043 * braking * ease(state.speed / 0.9) * (1 - ease(state.speed / 7.5)) * (wet ? 0.65 : 1),
    rain: wet ? exterior * (cab ? 0.25 : map ? 0.19 : 0.30) : 0,
    rainPitch: (cab ? 1460 : 2550) + state.speed * 17,
    wind: exterior * (map ? 0.2 : cab ? 0.09 : 0.19) * (0.22 + 0.78 * moving + (snow ? 0.42 : 0)),
    shore: exterior * clamp(state.lakeside) * (cab ? 0.09 : 0.20) * (1 - moving * 0.43),
  };
}

const BLOCK_LENGTH = 398;
const JOINTS_IN_BLOCK = [42, 167, 321];

export function railJointsCrossed(previous: number, distance: number): number[] {
  if (distance <= previous || distance - previous > 70) return [];
  const hits: number[] = [];
  for (let start = Math.floor(previous / BLOCK_LENGTH) * BLOCK_LENGTH;
    start <= distance; start += BLOCK_LENGTH) {
    for (const joint of JOINTS_IN_BLOCK) {
      const at = start + joint;
      if (at > previous && at <= distance) hits.push(at);
    }
  }
  return hits;
}

function nearShore(east: number, north: number, rings: LocalPoint[][], radius: number): number {
  let squared = radius * radius;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [ax, ay] = ring[previous];
      const [bx, by] = ring[index];
      const dx = bx - ax;
      const dy = by - ay;
      const t = clamp(((east - ax) * dx + (north - ay) * dy) / (dx * dx + dy * dy || 1));
      squared = Math.min(squared, (east - ax - dx * t) ** 2 + (north - ay - dy * t) ** 2);
    }
  }
  return squared;
}

export function createLakesideProfile(data: Pick<WorldData, 'features'>, rail: Rail): (chainage: number) => number {
  const radius = 185;
  const water = data.features.filter(feature => feature.type === 'water' && feature.points.length > 2).map(feature => {
    const rings = [feature.points, ...(feature.holes ?? [])];
    const extent = rings[0].reduce(([west, south, east, north], [x, y]) =>
      [Math.min(west, x), Math.min(south, y), Math.max(east, x), Math.max(north, y)],
    [Infinity, Infinity, -Infinity, -Infinity]);
    return { rings, extent };
  });
  if (!water.length) return () => 0;

  const samples = new Float32Array(Math.ceil(rail.length / 25) + 1);
  const step = rail.length / (samples.length - 1);
  const position = new Vector3();
  for (let index = 0; index < samples.length; index++) {
    rail.position(index * step, position);
    const { x, z } = position;
    let squared = radius * radius;
    for (const { rings, extent: [west, south, east, north] } of water) {
      if (x < west - radius || x > east + radius || -z < south - radius || -z > north + radius) continue;
      squared = Math.min(squared, nearShore(x, -z, rings, radius));
    }
    samples[index] = 1 - ease(Math.sqrt(squared) / radius);
  }
  return (chainage: number) => {
    const index = clamp(chainage / rail.length) * (samples.length - 1);
    const first = Math.floor(index);
    return samples[first] + ((samples[first + 1] ?? samples[first]) - samples[first]) * (index - first);
  };
}

function randomGenerator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const length = context.sampleRate * 7;
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const random = randomGenerator(637);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      const value = random() * 2 - 1;
      previous = previous * 0.81 + value * 0.19;
      samples[index] = value * 0.55 + previous * 0.45;
    }
  }
  return buffer;
}

function boreResponse(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(2, Math.round(rate * 2.15), rate);
  const random = randomGenerator(4932);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    const onset = Math.round(rate * (channel === 0 ? 0.017 : 0.022));
    let diffuse = 0;
    for (let index = onset; index < samples.length; index++) {
      const age = (index - onset) / rate;
      diffuse = 0.81 * diffuse + (random() * 2 - 1) * 0.19;
      samples[index] = diffuse * Math.min(1, age * 22) * Math.exp(-4.4 * age) * 0.12;
    }
    for (const [seconds, strength] of [[0.025, 0.31], [0.049, 0.22], [0.085, 0.19], [0.147, 0.13], [0.226, 0.08]]) {
      const at = onset + Math.round(rate * seconds * (channel === 0 ? 1 : 1.12));
      for (let index = 0; index < 36; index++) samples[at + index] += strength * Math.exp(-index * 0.22) * (1 - index % 2 * 0.35);
    }
  }
  return buffer;
}

function gain(context: BaseAudioContext, destination: AudioNode, amount: number): GainNode {
  const node = context.createGain();
  node.gain.value = amount;
  node.connect(destination);
  return node;
}

function filter(context: BaseAudioContext, destination: AudioNode, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz;
  node.Q.value = q;
  node.connect(destination);
  return node;
}

function oscillator(context: BaseAudioContext, destination: AudioNode, type: OscillatorType, hz: number): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.frequency.value = hz;
  node.connect(destination);
  return node;
}

function drive(param: AudioParam, value: number, time: number, duration = 0.085): void {
  param.setTargetAtTime(value, time, duration);
}

function envelope(param: AudioParam, start: number, level: number, attack: number, length: number, hold = 0): void {
  param.setValueAtTime(0.0001, start);
  param.exponentialRampToValueAtTime(Math.max(level, 0.0001), start + attack);
  if (hold) param.linearRampToValueAtTime(level * 0.7, start + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, start + length);
}

class SoundGraph {
  private readonly context: BaseAudioContext;
  readonly master: GainNode;
  readonly train: GainNode;
  readonly screen: BiquadFilterNode;
  readonly near: GainNode;
  readonly tunnel: GainNode;
  readonly equipment: GainNode;
  readonly traction: ReturnType<SoundGraph['tone']>;
  readonly inverter: ReturnType<SoundGraph['tone']>;
  readonly bogie: ReturnType<SoundGraph['bed']>;
  readonly tread: ReturnType<SoundGraph['bed']>;
  readonly brake: ReturnType<SoundGraph['bed']>;
  readonly squeal: ReturnType<SoundGraph['tone']>;
  readonly rain: ReturnType<SoundGraph['bed']>;
  readonly wind: ReturnType<SoundGraph['bed']>;
  readonly shore: ReturnType<SoundGraph['bed']>;
  private readonly noise: AudioBuffer;
  private readonly random = randomGenerator(893);

  constructor(context: BaseAudioContext) {
    this.context = context;
    this.noise = noiseBuffer(context);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -17;
    limiter.knee.value = 17;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    limiter.connect(context.destination);
    this.master = gain(context, limiter, 0);
    this.near = gain(context, this.master, 0.72);
    this.screen = filter(context, this.near, 'lowpass', 2700, 0.5);
    this.train = gain(context, this.screen, 1);
    const reverb = context.createConvolver();
    reverb.buffer = boreResponse(context);
    reverb.connect(this.screen);
    this.tunnel = gain(context, reverb, 0);
    this.train.connect(this.tunnel);

    this.equipment = gain(context, this.screen, 0);
    oscillator(context, this.equipment, 'sine', 50.2).start();
    oscillator(context, gain(context, this.equipment, 0.34), 'sine', 101.5).start();
    this.bed(this.equipment, 'bandpass', 585, 0.96, 0.43, 1.8);
    this.traction = this.tone('triangle', 38, this.train);
    this.inverter = this.tone('sine', 189, this.train);
    this.modulate(this.inverter.source.detune, 17, 8);
    this.bogie = this.bed(this.train, 'lowpass', 145, 0.51, 0, 0.1);
    this.tread = this.bed(this.train, 'bandpass', 395, 0.57, 0, 2.21);
    this.brake = this.bed(this.train, 'bandpass', 1460, 0.6, 0, 4.8);
    this.squeal = this.tone('triangle', 1280, this.train);
    this.modulate(this.squeal.source.frequency, 12, 31);
    this.rain = this.bed(this.master, 'bandpass', 1670, 0.64, 0, 1.13);
    this.wind = this.bed(this.master, 'lowpass', 420, 0.64, 0, 3.32);
    const lapping = gain(context, this.master, 0.65);
    this.modulate(lapping.gain, 0.38, 0.22);
    this.modulate(lapping.gain, 0.61, 0.11);
    this.shore = this.bed(lapping, 'bandpass', 580, 0.72, 0, 5.21);
  }

  private tone(type: OscillatorType, hz: number, destination: AudioNode) {
    const level = gain(this.context, destination, 0);
    const source = oscillator(this.context, level, type, hz);
    source.start();
    return { level: level.gain, source };
  }

  private bed(destination: AudioNode, type: BiquadFilterType, hz: number, q: number, level: number, offset: number) {
    const volume = gain(this.context, destination, level);
    const band = filter(this.context, volume, type, hz, q);
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(band);
    source.start(0, offset);
    return { level: volume.gain, band };
  }

  private modulate(target: AudioParam, hz: number, depth: number): void {
    const amount = this.context.createGain();
    amount.gain.value = depth;
    amount.connect(target);
    oscillator(this.context, amount, 'sine', hz).start();
  }

  mix(state: StationAudioState, muted: boolean): void {
    const mix = audioMixFor(state);
    const time = this.context.currentTime;
    drive(this.master.gain, muted ? 0 : mix.master, time, 0.06);
    drive(this.near.gain, mix.train, time, 0.2);
    drive(this.screen.frequency, mix.cutoff, time, 0.15);
    drive(this.tunnel.gain, mix.tunnel, time, 0.27);
    drive(this.equipment.gain, mix.equipment, time, 0.2);
    drive(this.traction.level, mix.torque, time, 0.14);
    drive(this.traction.source.frequency, mix.tone, time);
    drive(this.inverter.level, mix.inverter, time, 0.13);
    drive(this.inverter.source.frequency, mix.switchRate, time, 0.04);
    drive(this.bogie.level, mix.bogie, time);
    drive(this.tread.level, mix.tread, time);
    drive(this.tread.band.frequency, mix.treadPitch, time);
    drive(this.brake.level, mix.brake, time, 0.16);
    drive(this.squeal.level, mix.squeal, time, 0.18);
    drive(this.squeal.source.frequency, 1150 + state.speed * 46, time, 0.15);
    drive(this.rain.level, mix.rain, time, 0.38);
    drive(this.rain.band.frequency, mix.rainPitch, time, 0.23);
    drive(this.wind.level, mix.wind, time, 0.24);
    drive(this.shore.level, mix.shore, time, 0.65);
  }

  private noiseEvent(start: number, level: number, attack: number, length: number, hz: number, q: number,
    endHz = hz, destination = this.train): void {
    const volume = gain(this.context, destination, 0);
    const band = filter(this.context, volume, 'bandpass', hz, q);
    band.frequency.setValueAtTime(hz, start);
    band.frequency.exponentialRampToValueAtTime(endHz, start + length);
    envelope(volume.gain, start, level, attack, length);
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(band);
    source.start(start, this.random() * (this.noise.duration - 1));
    source.stop(start + length + 0.01);
    source.onended = () => { source.disconnect(); band.disconnect(); volume.disconnect(); };
  }

  private note(start: number, level: number, attack: number, length: number, hz: number, endHz: number,
    wave: OscillatorType, destination: AudioNode = this.train, hold = 0): void {
    const volume = gain(this.context, destination, 0);
    const source = oscillator(this.context, volume, wave, hz);
    source.frequency.setValueAtTime(hz, start);
    source.frequency.exponentialRampToValueAtTime(endHz, start + length);
    envelope(volume.gain, start, level, attack, length, hold);
    source.start(start);
    source.stop(start + length + 0.01);
    source.onended = () => { source.disconnect(); volume.disconnect(); };
  }

  joint(speed: number, bridge: boolean, timeScale: number, offset: number): void {
    const start = this.context.currentTime + offset;
    const interval = Math.max(0.023, 2.46 / Math.max(4, speed) / timeScale);
    const strength = Math.min(0.95, 0.29 + speed * 0.017) * (bridge ? 1.45 : 1);
    for (const [delay, level] of [[0, strength], [interval, strength * 0.76]]) {
      const hit = start + delay;
      this.noiseEvent(hit, level * 0.53, 0.002, 0.094, bridge ? 530 : 395, 0.95, 135);
      this.note(hit, level * 0.094, 0.002, 0.08, 92, 57, 'sine');
    }
  }

  doors(open: boolean): void {
    const time = this.context.currentTime;
    const chime = open ? [659.25, 880] : [880, 740, 880];
    for (const [index, hz] of chime.entries()) {
      const at = time + 0.023 + index * 0.147;
      this.note(at, 0.093, 0.009, 0.26, hz, hz, 'sine');
      this.note(at, 0.026, 0.004, 0.21, hz * 2.01, hz * 2.01, 'sine');
    }
    const motor = time + (open ? 0.04 : 0.42);
    this.noiseEvent(motor, 0.2, 0.08, 0.89, open ? 225 : 330, 0.8, 140);
    this.note(motor + 0.02, 0.038, 0.13, 0.57, open ? 91 : 141, open ? 155 : 77, 'triangle');
    this.noiseEvent(motor + 0.62, 0.36, 0.004, 0.115, open ? 770 : 530, 1.4, 230);
  }

  brakeAir(): void {
    this.noiseEvent(this.context.currentTime, 0.29, 0.04, 0.56, 2460, 0.58, 990);
  }

  rainDrop(state: StationAudioState): void {
    const start = this.context.currentTime;
    const hz = 1260 + this.random() * 1850;
    const level = (0.05 + this.random() * 0.15) * (state.view === 'cab' ? 1.35 : 0.68);
    this.noiseEvent(start, level, 0.002, 0.046 + this.random() * 0.06, hz, 1.7, hz * 0.53, this.master);
  }

  horn(lakeside: number, tunnel: boolean): void {
    const time = this.context.currentTime;
    const blend = filter(this.context, this.train, 'lowpass', 3050, 0.63);
    for (const [hz, strength] of [[184.8, 0.19], [247.6, 0.154], [309.1, 0.076]]) {
      this.note(time, strength, 0.07, 0.74, hz * 0.984, hz * 1.006, 'sawtooth', blend, 0.38);
    }
    this.noiseEvent(time, 0.116, 0.051, 0.55, 760, 0.63, 440);
    // Reflections across the valley are later and softer than the bore's short reflections.
    if (!tunnel) {
      for (const [delay, amount, side] of [[0.34, 0.34, -0.6], [0.66, 0.21, 0.62], [0.96, 0.11, -0.3]]) {
        const pan = this.context.createStereoPanner();
        pan.pan.value = side;
        pan.connect(this.train);
        const echo = filter(this.context, pan, 'lowpass', 1320 - delay * 680, 0.65);
        const at = time + delay * (1 + lakeside * 0.32);
        for (const hz of [184.8, 247.6, 309.1]) {
          this.note(at, 0.105 * amount * (0.76 + lakeside * 0.58), 0.09, 0.56, hz, hz * 0.994, 'triangle', echo, 0.13);
        }
        const release = this.context.createConstantSource();
        release.start();
        release.stop(at + 0.59);
        release.onended = () => { echo.disconnect(); pan.disconnect(); };
      }
    }
    const release = this.context.createConstantSource();
    release.start();
    release.stop(time + 0.78);
    release.onended = () => blend.disconnect();
  }
}

export class StationAudio {
  private context?: AudioContext;
  private graph?: SoundGraph;
  private state?: StationAudioState;
  private muted = false;
  private mixAt = 0;
  private releaseAt = 0;
  private rainAt = 0;
  private random = randomGenerator(1619);

  unlock(): void {
    if (!globalThis.AudioContext) return;
    if (!this.context) {
      try {
        const context = new AudioContext();
        this.graph = new SoundGraph(context);
        this.context = context;
      } catch {
        return;
      }
      if (this.state) this.graph.mix(this.state, this.muted);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.state) this.graph?.mix(this.state, this.muted);
  }

  horn(): void {
    this.unlock();
    this.graph?.horn(this.state?.lakeside ?? 0, this.state?.tunnel ?? false);
  }

  update(state: StationAudioState): void {
    const previous = this.state;
    this.state = state;
    if (!this.graph || !this.context) return;
    const now = this.context.currentTime;
    if (!previous || now >= this.mixAt || state.paused !== previous.paused || state.weather !== previous.weather
      || state.view !== previous.view || state.tunnel !== previous.tunnel) {
      this.graph.mix(state, this.muted);
      this.mixAt = now + 1 / 24;
    }
    if (!previous || state.paused || previous.paused || state.distance < previous.distance - 1) return;
    if (previous.doorsOpen !== state.doorsOpen) this.graph.doors(state.doorsOpen);
    const previousBrake = previous.brakeCommand ?? previous.brake;
    const brake = state.brakeCommand ?? state.brake;
    if (now >= this.releaseAt && previousBrake >= 0.15 && brake <= previousBrake - 0.12) {
      this.graph.brakeAir();
      this.releaseAt = now + 0.28;
    }
    const traveled = state.distance - previous.distance;
    if (state.speed > 1.8 && traveled > 0) {
      for (const at of railJointsCrossed(previous.distance, state.distance)) {
        this.graph.joint(state.speed, state.bridge, state.timeScale, ((at - previous.distance) / traveled) * 0.026);
      }
    }
    if (state.weather === 'rain' && !state.tunnel && now >= this.rainAt) {
      this.graph.rainDrop(state);
      this.rainAt = now + 0.045 + this.random() * 0.19 / (1 + state.speed * 0.018);
    }
  }
}
