"""Cross-check passenger landmarks omitted from the baked physical corridors."""

import argparse
from collections import defaultdict
import gzip
from itertools import pairwise
import json
from math import cos, floor, hypot, radians
from pathlib import Path

import osmium
from pyproj import Geod


CELL = 0.01
WGS84 = Geod(ellps="WGS84")


def metres(a, b):
    return WGS84.inv(*a, *b)[2]


def read_catalog(path):
    nodes, groups = {}, defaultdict(set)
    for item in osmium.FileProcessor(str(path), osmium.osm.NODE | osmium.osm.RELATION):
        if item.is_node():
            nodes[item.id] = ([item.location.lon, item.location.lat], dict(item.tags))
        elif item.tags.get("public_transport") == "stop_area":
            related = {member.ref for member in item.members if member.type == "n"}
            for osm_id in related:
                groups[osm_id].update(related)
    return nodes, groups


def source_segment_grid(path):
    grid = defaultdict(list)
    for a, b in pairwise(path):
        west, east = sorted((a["point"][0], b["point"][0]))
        south, north = sorted((a["point"][1], b["point"][1]))
        for x in range(floor(west / CELL), floor(east / CELL) + 1):
            for y in range(floor(south / CELL), floor(north / CELL) + 1):
                grid[x, y].append((a, b))
    return grid


def nearby_segment(point, grid, radius):
    lon, lat = point
    scale_x, scale_y = 111_320 * cos(radians(lat)), 111_132
    rx, ry = radius / scale_x, radius / scale_y
    closest = None
    for x in range(floor((lon - rx) / CELL), floor((lon + rx) / CELL) + 1):
        for y in range(floor((lat - ry) / CELL), floor((lat + ry) / CELL) + 1):
            for start, finish in grid.get((x, y), ()):
                a, b = start["point"], finish["point"]
                px, py = (a[0] - lon) * scale_x, (a[1] - lat) * scale_y
                dx, dy = (b[0] - a[0]) * scale_x, (b[1] - a[1]) * scale_y
                squared = dx * dx + dy * dy
                if squared:
                    ratio = max(0, min(1, -(px * dx + py * dy) / squared))
                    gap = hypot(px + ratio * dx, py + ratio * dy)
                    if gap <= radius and (closest is None or gap < closest[0]):
                        closest = gap, finish["way"]
    return closest


def normalize(name):
    return " ".join(name.casefold().removesuffix(" stasjon").removesuffix(" haldeplass").split())


def find_omissions(manifest_path, catalog, relations, radius):
    found = []
    manifest = json.loads(manifest_path.read_text())
    for line in manifest["services"]:
        source_path = manifest_path.parent / line["sourcePathUrl"].removeprefix("data/")
        with gzip.open(source_path, "rt") as source:
            raw = json.load(source)
        path = raw["sourcePath"]
        path_nodes = {point["node"] for point in path}
        grid = source_segment_grid(path)
        included = {station["osmId"] for station in line["stations"]}
        for station in line["stations"]:
            point, tags = catalog[station["osmId"]]
            if station["name"] != tags.get("name") or metres(point, station["sourcePosition"]) > 0.01:
                raise ValueError(f"{line['ref']} station n{station['osmId']} differs from the pinned OSM extract")
        nearby = []
        for osm_id, (point, tags) in sorted(catalog.items()):
            if (osm_id in included or tags.get("railway") not in {"station", "halt"}
                or tags.get("railway:traffic_mode") not in {"passenger", "mixed"} or not tags.get("name")):
                continue
            projection = nearby_segment(point, grid, radius)
            if not projection:
                continue
            name = normalize(tags["name"])
            named_calls = {
                node_id for node_id, (call_point, call) in catalog.items()
                if call.get("public_transport") == "stop_position" and call.get("train") == "yes"
                and (node_id in relations[osm_id] or normalize(call.get("name", "")) == name)
                and metres(point, call_point) <= 250
            }
            gap, route_way = projection
            nearby.append({
                "line": line["ref"], "name": tags["name"], "id": osm_id, "gap": gap,
                "calls": named_calls, "on_route": named_calls & path_nodes,
                "route_way": route_way, "route_name": raw["ways"][str(route_way)]["tags"].get("name"),
                "path_ways": {item["way"] for item in path[1:]},
            })
        found.extend(nearby)
        print(f"{line['ref']}: {len(included)} names and source coordinates checked against OSM; "
              f"{len(nearby)} unlisted passenger/mixed landmarks within {radius:g} m")
    return found


def find_rail_ways(corridor, omissions):
    needed = {node for item in omissions for node in item["calls"]}
    ways = defaultdict(dict)
    stream = osmium.FileProcessor(str(corridor), osmium.osm.WAY).with_filter(
        osmium.filter.TagFilter(("railway", "rail")),
    )
    for way in stream:
        hits = {node.ref for node in way.nodes} & needed
        for node_id in hits:
            ways[node_id][way.id] = way.tags.get("name") or "unnamed"
    return ways


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--corridor", type=Path, required=True)
    parser.add_argument("--radius", type=float, default=350)
    args = parser.parse_args()
    catalog, relations = read_catalog(args.catalog)
    omissions = find_omissions(args.manifest, catalog, relations, args.radius)
    ways = find_rail_ways(args.corridor, omissions)
    unresolved = 0
    for station in omissions:
        calls = sorted(station["calls"])
        track = sorted({(way, name) for node in calls for way, name in ways[node].items()})
        unmapped = [node for node in calls if not ways[node]]
        shares_way = any(way in station["path_ways"] for way, _ in track)
        uncertain = not calls or bool(unmapped) or bool(station["on_route"]) or shares_way
        if uncertain:
            unresolved += 1
        source_tracks = ", ".join(f"w{way} {name}" for way, name in track) or "none"
        print(f"{station['line']} {station['name']} n{station['id']}: "
              f"{station['gap']:.1f} m from selected w{station['route_way']} {station['route_name']}; "
              f"calls {calls}; participating tracks {source_tracks}; "
              f"{'requires review' if uncertain else 'other alignment'}")
        if uncertain:
            print(f"  Unmapped calls {unmapped}; selected route calls {sorted(station['on_route'])}; shared way {shares_way}")
    print(f"Omitted named passenger/mixed station landmarks with unresolved alignment: {unresolved}")
    return int(unresolved > 0)


if __name__ == "__main__":
    raise SystemExit(main())
