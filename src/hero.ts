import type { Vector3 } from 'three';
import type { Cameras, View } from './cameras';
import type { NetworkRoute } from './network';

interface Shot {
  id: string;
  view: View;
  distance: number;
  speed: number;
  orbit?: [number, number, number];
  height?: number;
  lift?: number;
  mapLean?: number;
}

export function heroShots(route: NetworkRoute): Shot[] {
  const [evanger, seimsgrend, bulken, voss] = route.stations;
  if (!voss) throw new Error('The hero gallery requires the four R40 stations');
  const tunnel = route.spans.find(span => span.tunnel && span.start > seimsgrend.stopDistance && span.end < bulken.stopDistance);
  const bridge = route.spans.filter(span => span.bridge && span.start > seimsgrend.stopDistance && span.end < bulken.stopDistance)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!bridge || !tunnel) throw new Error('The hero gallery needs the mapped Bulken approach structures');
  const lake = seimsgrend.stopDistance + (bridge.start - seimsgrend.stopDistance) * .64;
  return [
    { id: '01-lakeside-chase', view: 'chase', distance: lake, speed: 17, orbit: [28, 1.24, 2.19], lift: 4.3 },
    { id: '02-evanger-cab', view: 'cab', distance: evanger.stopDistance + 240, speed: 13 },
    { id: '03-seimsgrend', view: 'chase', distance: seimsgrend.stopDistance, speed: 0, orbit: [22, 1.39, 1.80], lift: 1.1 },
    { id: '04-river-bridge', view: 'chase', distance: (bridge.start + bridge.end) * .5, speed: 16, orbit: [35, 1.37, -1.96], lift: 2.5 },
    { id: '05-tunnel-mouth', view: 'chase', distance: tunnel.end + 22, speed: 14, orbit: [31, 1.27, 2.16], lift: 1.8 },
    { id: '06-bulken-cab', view: 'cab', distance: bulken.stopDistance - 38, speed: 8 },
    { id: '07-lake-overlook', view: 'map', distance: lake + 180, speed: 16, height: 148, mapLean: .95, lift: 3 },
    { id: '08-voss-overlook', view: 'map', distance: voss.stopDistance - 20, speed: 3, height: 105 },
  ];
}

export function frameHero(cameras: Cameras, shot: Shot, train: Vector3): void {
  cameras.select(shot.view);
  if (shot.orbit) cameras.setChaseOrbit(...shot.orbit);
  if (shot.height) cameras.fitMap(train, train, shot.height, true);
  cameras.cut(shot.lift, shot.mapLean);
}
