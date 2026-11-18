"""Derive browseable, source-auditable long-distance topology from pinned OSM."""

import argparse
from collections import defaultdict
from heapq import heappop, heappush
from itertools import pairwise
import json
from math import cos, floor, hypot, radians
import os
from pathlib import Path
import subprocess

import osmium
from pyproj import Geod

from extract_osm import extract
from source_data import CACHE, osm_snapshot


CORRIDORS = (
    ("F4", 9531104, (3661061, 18567357)),
    ("F5", 9526747, (1837965, 1837963)),
    ("F6", 8854197, (965964, 8854645, 21236676)),
)
# The pinned extract has construction on the former track 1. These connected
# OSM ways carry traffic on track 2 and are absent from the passenger relation.
OPEN_TRACK_SUPPLEMENTS = {
    "F6": (1526404372, 1526404374, 1526404375, 1526404377, 1527503042, 1564378420),
}
GEODESY = Geod(ellps="WGS84")
PIECE_MARGIN = 80
CELL_SIZE = 0.01
APPROACH_LENGTH = 100


def distance(a, b):
    return GEODESY.inv(*a, *b)[2]


def track_members(relation, ways):
    return {
        osm_id for kind, osm_id, role in relation["members"]
        if kind == "w" and not role.startswith(("stop", "platform"))
        and ways[str(osm_id)]["tags"].get("railway") == "rail"
    }


def route_graph(ways, primary, additional):
    edges = defaultdict(list)
    points = {}
    for osm_id in sorted(primary | additional):
        way = ways[str(osm_id)]
        for node, point in zip(way["nodeIds"], way["points"], strict=True):
            points[node] = point
        for a, b in pairwise(way["nodeIds"]):
            length = distance(points[a], points[b])
            if a == b or length <= 0:
                continue
            extra = 0 if osm_id in primary else length
            edges[a].append((b, osm_id, length, extra))
            edges[b].append((a, osm_id, length, extra))
    return edges, points


def trace(edges, start, finish):
    if start == finish:
        return []
    shortest = {start: (0, 0)}
    previous = {}
    queue = [(0, 0, start)]
    while queue:
        extra, length, current = heappop(queue)
        if (extra, length) != shortest[current]:
            continue
        if current == finish:
            leg = []
            while current != start:
                origin, way, segment = previous[current]
                leg.append((current, way, segment))
                current = origin
            return list(reversed(leg))
        for adjacent, osm_way, segment, penalty in edges[current]:
            candidate = extra + penalty, length + segment
            if adjacent in shortest and candidate >= shortest[adjacent]:
                continue
            shortest[adjacent] = candidate
            previous[adjacent] = current, osm_way, segment
            heappush(queue, (*candidate, adjacent))
    return None


def endpoint_approach(graph, points, node, interior, track, ways):
    """Walk directly continuing in the sourced outward direction."""
    current, previous = node, interior
    traversed = {node, interior}
    preferred_ref = ways[str(track)]["tags"].get("railway:track_ref")
    length = 0
    result = []
    while length < APPROACH_LENGTH:
        incoming = GEODESY.inv(*points[previous], *points[current])[0]
        candidates = []
        for neighbor, osm_way, segment, _ in graph[current]:
            if neighbor in traversed:
                continue
            direction = GEODESY.inv(*points[current], *points[neighbor])[0]
            alignment = cos(radians(direction - incoming))
            if alignment < 0.72:
                continue
            candidate_ref = ways[str(osm_way)]["tags"].get("railway:track_ref")
            different_track = preferred_ref is not None and candidate_ref != preferred_ref
            candidates.append((different_track, -alignment, osm_way, neighbor, segment))
        if not candidates:
            break
        _, _, osm_way, neighbor, segment = min(candidates)
        result.append((neighbor, osm_way))
        length += segment
        traversed.add(neighbor)
        previous, current = current, neighbor
    return result, round(length, 4)


def route_alignment(inventory, relation, supplemental, open_ways=()):
    relation_data = inventory["relations"][str(relation)]
    stop_ids = [
        osm_id for kind, osm_id, role in relation_data["members"]
        if kind == "n" and role.startswith("stop")
    ]
    primary = track_members(relation_data, inventory["ways"])
    extra = set(open_ways)
    for relation_id in supplemental:
        extra |= track_members(inventory["relations"][str(relation_id)], inventory["ways"])
    normal, primary_positions = route_graph(inventory["ways"], primary, set())
    fallback, positions = route_graph(inventory["ways"], primary, extra)
    if len(stop_ids) < 2 or stop_ids[0] not in positions:
        raise ValueError(f"Train relation {relation} has missing route endpoints")
    total = 0
    current = stop_ids[0]
    path = [{"node": current, "way": None, "point": primary_positions.get(current, positions[current]), "distance": total}]
    stop_indices = {current: 0}
    for origin, destination in pairwise(stop_ids):
        leg = trace(normal, origin, destination)
        if leg is None:
            leg = trace(fallback, origin, destination)
            if leg is None:
                raise ValueError(f"Train relation {relation} cannot connect source stops {origin} and {destination}")
        for node, way, length in leg:
            total += length
            path.append({"node": node, "way": way, "point": positions[node], "distance": round(total, 4)})
        stop_indices[destination] = len(path) - 1
    if len(path) < 2:
        raise ValueError(f"Train relation {relation} has no rail between its stops")
    starts, start_approach = endpoint_approach(
        fallback, positions, path[0]["node"], path[1]["node"], path[1]["way"], inventory["ways"],
    )
    ends, end_approach = endpoint_approach(
        fallback, positions, path[-1]["node"], path[-2]["node"], path[-1]["way"], inventory["ways"],
    )
    original_start = path[0]["node"]
    full_path = [(item["node"], item["way"]) for item in path]
    if starts:
        before = [original_start, *[node for node, _ in starts[:-1]]]
        reverse_approach = [
            (node, edge[1]) for node, edge in zip(reversed(before), reversed(starts), strict=True)
        ]
        full_path = [(starts[-1][0], None), *reverse_approach, *full_path[1:]]
    full_path.extend(ends)
    path = []
    chainage = 0
    for node, osm_way in full_path:
        point = positions[node]
        if path:
            chainage += distance(path[-1]["point"], point)
        path.append({"node": node, "way": osm_way, "point": point, "distance": round(chainage, 4)})
    stop_indices = {node: index + len(starts) for node, index in stop_indices.items()}
    return path, stop_indices, primary, {"start": start_approach, "end": end_approach}


def osmium_extract(output, arguments):
    if output.is_file() and output.stat().st_size:
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix(".partial.osm.pbf")
    subprocess.run([
        os.environ.get("OSMIUM_BIN", "osmium"), *arguments,
        "--output", str(pending), "--no-progress", "--overwrite",
    ], check=True)
    pending.replace(output)
    return output


def open_track_inventory(snapshot, way_ids):
    processor = osmium.FileProcessor(
        str(snapshot), osmium.osm.NODE | osmium.osm.WAY,
    ).with_locations("flex_mem").with_filter(osmium.filter.IdFilter(way_ids))
    results = {}
    for way in processor:
        if not way.is_way():
            continue
        if way.tags.get("railway") != "rail" or any(not node.location.valid() for node in way.nodes):
            raise ValueError(f"Supplemental OSM way {way.id} is not complete operating rail")
        results[str(way.id)] = {
            "tags": dict(way.tags),
            "nodeIds": [node.ref for node in way.nodes],
            "points": [[node.location.lon, node.location.lat] for node in way.nodes],
        }
    if missing := set(way_ids) - {int(key) for key in results}:
        raise ValueError(f"Missing supplemental OSM rail ways: {sorted(missing)}")
    return results


def source_metadata(snapshot):
    routes = []
    processor = osmium.FileProcessor(str(snapshot), osmium.osm.RELATION).with_filter(
        osmium.filter.TagFilter(("route", "train")),
    )
    for relation in processor:
        if relation.tags.get("type") != "route":
            continue
        tracks = set()
        stops = set()
        for member in relation.members:
            if member.type == "w" and not member.role.startswith(("stop", "platform")):
                tracks.add(member.ref)
            elif member.type == "n" and member.role.startswith("stop"):
                stops.add(member.ref)
        if tracks and stops:
            routes.append({"id": relation.id, "ref": relation.tags.get("ref"), "ways": tracks, "stops": stops})
    return routes


def mapped_stops(snapshot):
    nodes = {}
    areas = {}
    for item in osmium.FileProcessor(str(snapshot), osmium.osm.NODE | osmium.osm.RELATION):
        if item.is_node():
            nodes[item.id] = {"point": [item.location.lon, item.location.lat], "tags": dict(item.tags)}
        elif item.tags.get("public_transport") == "stop_area":
            area_nodes = [member.ref for member in item.members if member.type == "n"]
            for osm_id in area_nodes:
                areas[osm_id] = area_nodes
    return nodes, areas


def simplified_name(name):
    return " ".join(name.casefold().removesuffix(" stasjon").removesuffix(" haldeplass").split())


def landmark(osm_id, node, landmarks, all_nodes, areas):
    for candidate in areas.get(osm_id, []):
        if candidate in landmarks:
            return candidate, all_nodes[candidate]
    name = simplified_name(node["tags"].get("name", ""))
    matching = [
        (distance(node["point"], item["point"]), candidate, item)
        for candidate, item in landmarks.items()
        if name in {
            simplified_name(item["tags"].get(field, ""))
            for field in ("name", "alt_name", "official_name")
        }
    ]
    if matching:
        displacement, candidate, item = min(matching, key=lambda match: (match[0], match[1]))
        if displacement <= 750:
            return candidate, item
    return osm_id, node


def segment_index(path):
    cells = defaultdict(list)
    for left, right in pairwise(path):
        a, b = left["point"], right["point"]
        west, east = sorted((a[0], b[0]))
        south, north = sorted((a[1], b[1]))
        for x in range(floor(west / CELL_SIZE), floor(east / CELL_SIZE) + 1):
            for y in range(floor(south / CELL_SIZE), floor(north / CELL_SIZE) + 1):
                cells[x, y].append((left, right))
    return cells


def nearest_projection(point, cells):
    scale_x = 111_320 * cos(radians(point[1]))
    scale_y = 111_132
    result = None
    lon, lat = point
    lon_margin = PIECE_MARGIN / scale_x
    lat_margin = PIECE_MARGIN / scale_y
    seen = set()
    segments = (
        segment
        for x in range(floor((lon - lon_margin) / CELL_SIZE), floor((lon + lon_margin) / CELL_SIZE) + 1)
        for y in range(floor((lat - lat_margin) / CELL_SIZE), floor((lat + lat_margin) / CELL_SIZE) + 1)
        for segment in cells.get((x, y), ())
    )
    for left, right in segments:
        if left["distance"] in seen:
            continue
        seen.add(left["distance"])
        lon0, lat0 = left["point"]
        lon1, lat1 = right["point"]
        lon, lat = point
        if (
            lon < min(lon0, lon1) - PIECE_MARGIN / scale_x or lon > max(lon0, lon1) + PIECE_MARGIN / scale_x
            or lat < min(lat0, lat1) - PIECE_MARGIN / scale_y or lat > max(lat0, lat1) + PIECE_MARGIN / scale_y
        ):
            continue
        x0, y0 = (lon0 - lon) * scale_x, (lat0 - lat) * scale_y
        dx, dy = (lon1 - lon0) * scale_x, (lat1 - lat0) * scale_y
        if dx == 0 and dy == 0:
            continue
        part = min(1, max(0, -(x0 * dx + y0 * dy) / (dx * dx + dy * dy)))
        gap = hypot(x0 + part * dx, y0 + part * dy)
        if result is None or gap < result[0]:
            result = (
                gap,
                left["distance"] + part * (right["distance"] - left["distance"]),
                right["way"],
            )
    return result


def route_stations(path, exact_stops, catalog, areas, routes, fallback_nodes, ways):
    path_ways = {item["way"] for item in path}
    overlapping = [route for route in routes if route["ways"] & path_ways]
    served_by = defaultdict(list)
    for route in overlapping:
        for osm_id in route["stops"]:
            served_by[osm_id].append(route)
    source_nodes = {**fallback_nodes, **catalog}
    all_landmarks = {
        osm_id: node for osm_id, node in catalog.items()
        if node["tags"].get("railway") in {"station", "halt"}
        and node["tags"].get("name") and node["tags"].get("railway:traffic_mode") not in {"freight", "industrial"}
    }
    path_indices = {item["node"]: index for index, item in enumerate(path)}
    segments = segment_index(path)
    candidates = {}
    for osm_id in sorted(exact_stops.keys() | served_by.keys() | all_landmarks.keys()):
        node = source_nodes.get(osm_id)
        if not node or not node["tags"].get("name"):
            continue
        position = path_indices.get(osm_id)
        if osm_id in exact_stops:
            position = exact_stops[osm_id]
        if position is not None:
            match = 0, path[position]["distance"], path[position]["way"]
        else:
            match = nearest_projection(node["point"], segments)
            if match is None or match[0] > PIECE_MARGIN:
                continue
        gap, chainage, way_id = match
        route_hits = [route for route in served_by[osm_id] if way_id in route["ways"]]
        if position is None and not route_hits:
            closest_way = ways[str(way_id)]["tags"]
            if closest_way.get("tunnel", "no") != "no" or closest_way.get("highspeed") == "yes":
                # A surface platform or neighboring line does not acquire a call
                # just because an underground/express track passes nearby.
                continue
            if osm_id not in all_landmarks and gap > 15:
                continue
            neighbor_ways = {
                item["way"] for item in path
                if abs(item["distance"] - chainage) < 900
            }
            route_hits = [route for route in served_by[osm_id] if route["ways"] & neighbor_ways]
            if not route_hits and node["tags"].get("railway:traffic_mode") not in {"passenger", "mixed"}:
                continue
        station_id, station = landmark(osm_id, node, all_landmarks, source_nodes, areas)
        if station_id == osm_id and position is not None:
            call_proof = "source-route-stop" if osm_id in exact_stops else "track-node"
        elif position is not None:
            call_proof = "track-node"
        else:
            call_proof = "nearby-shared-service" if route_hits else "passenger-station"
        reverse = position is not None and 0 < position < len(path) - 1 and path[position - 1]["node"] == path[position + 1]["node"]
        record = {
            "name": station["tags"]["name"],
            "osmId": station_id,
            "sourcePosition": station["point"],
            "sourceTags": station["tags"],
            "stopOsmId": osm_id,
            "stopDistance": round(chainage, 4),
            "reversal": reverse,
            "serviceStop": osm_id in exact_stops,
            "servedBy": sorted({route["ref"] for route in served_by[osm_id] if route["ref"]}),
            "stopProof": call_proof,
        }
        score = (osm_id not in exact_stops, position is None, osm_id in all_landmarks, gap, osm_id)
        previous = candidates.get(station_id)
        if previous is None or score < previous[0]:
            candidates[station_id] = score, record
    distinct = []
    for score, record in sorted(candidates.values(), key=lambda entry: entry[0]):
        current = next((
            existing for existing in distinct
            if simplified_name(existing["name"]) == simplified_name(record["name"])
            and abs(existing["stopDistance"] - record["stopDistance"]) <= 150
            and not (existing["serviceStop"] and record["serviceStop"])
        ), None)
        if current:
            current["servedBy"] = sorted(set(current["servedBy"]) | set(record["servedBy"]))
        else:
            distinct.append(record)
    return sorted(distinct, key=lambda item: item["stopDistance"])


def build(inventory, station_catalog, railway_snapshot, corridors=CORRIDORS):
    catalog, areas = mapped_stops(station_catalog)
    source_routes = source_metadata(railway_snapshot)
    fallback_nodes = {int(osm_id): item for osm_id, item in inventory["nodes"].items()}
    services = []
    used_ways = set()
    for ref, relation, supplemental in corridors:
        path, stop_indices, members, approaches = route_alignment(
            inventory, relation, supplemental, OPEN_TRACK_SUPPLEMENTS.get(ref, ()),
        )
        stations = route_stations(
            path, stop_indices, catalog, areas, source_routes, fallback_nodes, inventory["ways"],
        )
        status = {station["stopOsmId"] for station in stations}
        if missing := stop_indices.keys() - status:
            raise ValueError(f"{ref} loses OSM service stops after station reconciliation: {sorted(missing)}")
        ways = {item["way"] for item in path[1:]}
        used_ways.update(ways)
        services.append({
            "ref": ref,
            "sourceRelation": relation,
            "sourcePath": path,
            "stations": stations,
            "serviceStopIds": list(stop_indices),
            "approachMeters": approaches,
            "supplementalWays": sorted(ways - members),
        })
        print(f"{ref}: {len(stations)} passenger stations, {path[-1]['distance'] / 1000:.2f} km, "
              f"{len(stop_indices)} express calls, {len(ways - members)} supplemental ways, "
              f"reversals: {[station['name'] for station in stations if station['reversal']]}", flush=True)
    return {"services": services, "ways": {str(osm_id): inventory["ways"][str(osm_id)] for osm_id in sorted(used_ways)}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--inventory", action="append", type=Path, default=[])
    parser.add_argument("--stations", type=Path)
    parser.add_argument("--open-ways", type=Path)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--services", nargs="+", choices=[item[0] for item in CORRIDORS])
    args = parser.parse_args()
    source = args.snapshot or osm_snapshot()
    corridors = [item for item in CORRIDORS if args.services is None or item[0] in args.services]
    ids = sorted({osm_id for _, primary, fallback in corridors for osm_id in (primary, *fallback)})
    inventory = {"relations": {}, "ways": {}, "nodes": {}}
    for path in args.inventory:
        for key, records in json.loads(path.read_text()).items():
            inventory[key].update(records)
    if missing := [osm_id for osm_id in ids if str(osm_id) not in inventory["relations"]]:
        for key, records in extract(source, missing).items():
            inventory[key].update(records)
    station_catalog = args.stations or osmium_extract(CACHE / "network-stops.osm.pbf", [
        "tags-filter", "-R", str(source), "n/railway=station,halt",
        "n/public_transport=stop_position", "r/public_transport=stop_area",
    ])
    open_ids = sorted({osm_id for ref, *_ in corridors for osm_id in OPEN_TRACK_SUPPLEMENTS.get(ref, ())})
    if open_ids:
        path = args.open_ways or osmium_extract(CACHE / "network-extra-track.osm.pbf", [
            "getid", "--add-referenced", str(source), *[f"w{osm_id}" for osm_id in open_ids],
        ])
        inventory["ways"].update(open_track_inventory(path, open_ids))
    product = build(inventory, station_catalog, source, corridors)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pending = args.output.with_suffix(".partial.json")
    pending.write_text(json.dumps(product, ensure_ascii=False, separators=(",", ":")) + "\n")
    pending.replace(args.output)
