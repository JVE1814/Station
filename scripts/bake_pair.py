"""Bake a playable corridor between two consecutive OSM stop positions."""

import argparse
import json
from itertools import pairwise
from math import ceil, exp, hypot
from pathlib import Path

from pyproj import CRS, Transformer

from align import alignment
from extract_osm import extract, extract_vicinity
from grade import constrain_grade
from source_data import CACHE, osm_snapshot
from terrain import sample_height, terrain_grid


def feature_kind(tags):
    if tags.get("railway") == "platform" or tags.get("public_transport") == "platform":
        return "platform"
    if tags.get("railway") == "rail":
        return "track"
    if "building" in tags:
        return "building"
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return "forest"
    if tags.get("natural") == "water" or tags.get("landuse") == "reservoir" or tags.get("waterway") == "riverbank":
        return "water"
    return None


def span_metadata(way_id, tags, start, end):
    raw_speed = tags.get("maxspeed", "")
    return {
        "osmWay": way_id,
        "start": round(start, 4),
        "end": round(end, 4),
        "tunnel": tags.get("tunnel", "no") != "no",
        "bridge": tags.get("bridge", "no") != "no",
        "electrified": tags.get("electrified") == "contact_line",
        "speedLimit": int(raw_speed) if raw_speed.isdecimal() else None,
    }


def rail_profile(path, ways, project, grid):
    points = []
    spans = []
    distance = 0.0
    chainages = {path[0]["node"]: 0.0}
    first_east, first_north = project(*path[0]["point"])
    points.append((distance, first_east, first_north, sample_height(grid, first_east, first_north)))
    for first, second in pairwise(path):
        east, north = project(*first["point"])
        finish_east, finish_north = project(*second["point"])
        length = hypot(finish_east - east, finish_north - north)
        if length == 0:
            continue
        way_id = second["way"]
        if spans and spans[-1]["osmWay"] == way_id:
            spans[-1]["end"] = round(distance + length, 4)
        else:
            spans.append(span_metadata(way_id, ways[str(way_id)]["tags"], distance, distance + length))

        divisions = ceil(length / 4)
        for division in range(1, divisions + 1):
            fraction = division / divisions
            x = east + fraction * (finish_east - east)
            y = north + fraction * (finish_north - north)
            points.append((distance + fraction * length, x, y, sample_height(grid, x, y)))
        distance += length
        chainages[second["node"]] = distance

    structures = []
    for span in spans:
        if not (span["tunnel"] or span["bridge"]):
            continue
        if structures and structures[-1]["end"] == span["start"] and (
            structures[-1]["tunnel"] == span["tunnel"] and structures[-1]["bridge"] == span["bridge"]
        ):
            structures[-1]["end"] = span["end"]
        else:
            structures.append(span.copy())
    for span in structures:
        interior = [index for index, point in enumerate(points) if span["start"] < point[0] < span["end"]]
        if not interior:
            continue
        left = points[max(0, interior[0] - 1)]
        right = points[min(len(points) - 1, interior[-1] + 1)]
        for index in interior:
            chainage, east, north, _ = points[index]
            height = left[3] + (right[3] - left[3]) * (chainage - left[0]) / (right[0] - left[0])
            points[index] = (chainage, east, north, height)

    profile = []
    lo, hi = 0, 0
    for distance, east, north, _ in points:
        while points[lo][0] < distance - 60:
            lo += 1
        while hi < len(points) and points[hi][0] <= distance + 60:
            hi += 1
        weights = [
            (exp(-0.5 * ((other_distance - distance) / 24) ** 2), height)
            for other_distance, _, _, height in points[lo:hi]
        ]
        height = sum(weight * value for weight, value in weights) / sum(weight for weight, _ in weights)
        profile.append({
            "distance": round(distance, 4),
            "east": round(east, 4),
            "north": round(north, 4),
            "height": height + 0.22,
        })
    heights = constrain_grade(
        [point["distance"] for point in profile],
        [point["height"] for point in profile],
        0.027,
    )
    for point, height in zip(profile, heights, strict=True):
        point["height"] = round(height, 4)
    return profile, spans, chainages


def signal_feature(osm_id, item, alignment_path, alignment_chainages, local_ways, project):
    source_id = int(osm_id)
    tags = item["tags"]
    point = list(project(*item["point"]))
    result = {"osmId": source_id, "type": "signal", "tags": tags, "points": [point]}
    direction = tags.get("railway:signal:direction", "both")
    for index, entry in enumerate(alignment_path[:-1]):
        if entry["node"] != source_id:
            continue
        following = alignment_path[index + 1]
        way = local_ways.get(str(following["way"]))
        if way is None:
            break
        nodes = way["nodeIds"]
        along = nodes.index(source_id) < nodes.index(following["node"])
        faces_service = direction in {"both", "forward" if along else "backward"}
        heading = project(*following["point"])
        sign = 1 if faces_service else -1
        result.update({
            "chainage": round(alignment_chainages[source_id], 4),
            "facesService": faces_service,
            "heading": [sign * (heading[0] - point[0]), sign * (heading[1] - point[1])],
        })
        return result

    for way in local_ways.values():
        if way["tags"].get("railway") != "rail":
            continue
        nodes = way["nodeIds"]
        if source_id not in nodes:
            continue
        index = nodes.index(source_id)
        a, b = (project(*way["points"][i]) for i in (max(0, index - 1), min(len(nodes) - 1, index + 1)))
        sign = -1 if direction == "backward" else 1
        result["heading"] = [sign * (b[0] - a[0]), sign * (b[1] - a[1])]
        break
    return result


def bake(inventory, relation_id, start, finish, output, timetable=None):
    path = alignment(inventory, relation_id, start, finish)
    relation = inventory["relations"][str(relation_id)]
    stops = [node for kind, node, role in relation["members"] if kind == "n" and role.startswith("stop")]
    start_index = stops.index(start)
    finish_index = stops.index(finish)
    if start_index > 0:
        lead_in = alignment(inventory, relation_id, stops[start_index - 1], start)
        threshold = lead_in[-1]["distance"] - 95
        prefix_index = max((index for index, item in enumerate(lead_in) if item["distance"] < threshold), default=0)
        path[0] = lead_in[-1]
        path = lead_in[prefix_index:-1] + path
    if finish_index + 1 < len(stops):
        lead_out = alignment(inventory, relation_id, finish, stops[finish_index + 1])
        suffix = next((index for index, item in enumerate(lead_out) if item["distance"] >= 85), len(lead_out) - 1)
        path += lead_out[1:suffix + 1]
    longitude, latitude = zip(*(entry["point"] for entry in path))
    projection = f"+proj=aeqd +lat_0={sum(latitude) / len(latitude)} +lon_0={sum(longitude) / len(longitude)} +datum=WGS84 +units=m"
    local = CRS.from_proj4(projection)
    project = Transformer.from_crs("EPSG:4326", local, always_xy=True).transform
    unproject = Transformer.from_crs(local, "EPSG:4326", always_xy=True).transform
    east, north = zip(*(project(lon, lat) for lon, lat in zip(longitude, latitude, strict=True)))
    padding = 850
    metric_bounds = min(east) - padding, min(north) - padding, max(east) + padding, max(north) + padding
    left, bottom, right, top = metric_bounds
    sample_corners = [unproject(x, y) for x in (left, right) for y in (bottom, top)]
    longitude, latitude = zip(*sample_corners)
    bounds = min(latitude), min(longitude), max(latitude), max(longitude)
    work = CACHE / f"pair-{relation_id}-{start}-{finish}"
    work.mkdir(parents=True, exist_ok=True)
    features_cache = work / "local-features.json"
    if features_cache.exists():
        vicinity = json.loads(features_cache.read_text())
    else:
        vicinity = extract_vicinity(osm_snapshot(), bounds, work)
        features_cache.write_text(json.dumps(vicinity, ensure_ascii=False))
    grid = terrain_grid(work, bounds, metric_bounds, projection, 12)
    profile, spans, chainages = rail_profile(path, inventory["ways"], project, grid)
    grid["samples"] = [round(sample, 3) for sample in grid["samples"]]

    stations = []
    for stop in (start, finish):
        chainage = round(chainages[stop], 4)
        names = []
        position = inventory["nodes"][str(stop)]["point"]
        east, north = project(*position)
        for node_id, node in vicinity["nodes"].items():
            tags = node["tags"]
            if tags.get("railway") not in {"station", "halt"} or not tags.get("name"):
                continue
            station_east, station_north = project(*node["point"])
            names.append((hypot(east - station_east, north - station_north), int(node_id), tags["name"], [station_east, station_north], node["point"], tags))
        if not names or min(names)[0] > 400:
            raise ValueError(f"No OSM station node near stop position {stop}")
        _, osm_id, name, local_point, source, source_tags = min(names)
        stations.append({
            "name": name, "osmId": osm_id, "position": local_point,
            "sourcePosition": source, "sourceTags": source_tags, "stopOsmId": stop, "stopDistance": chainage,
        })

    features = []
    active_ways = {entry["way"] for entry in path}
    for osm_id, item in vicinity["ways"].items():
        kind = feature_kind(item["tags"])
        points = item["points"]
        if kind == "track":
            if int(osm_id) in active_ways:
                continue
            longitudes, latitudes = zip(*points)
            south, west, north, east = bounds
            if min(latitudes) > north or max(latitudes) < south or min(longitudes) > east or max(longitudes) < west:
                continue
        if kind and len(points) >= (2 if kind == "track" else 3):
            features.append({
                "osmId": int(osm_id), "type": kind, "tags": item["tags"],
                "points": [[round(value, 3) for value in project(*point)] for point in points],
            })

    for item in vicinity["areas"]:
        kind = feature_kind(item["tags"])
        if not kind:
            continue
        shape = [[[round(value, 3) for value in project(*point)] for point in ring] for ring in item["rings"]]
        features.append({
            "osmId": item["id"], "osmElement": "relation", "type": kind,
            "tags": item["tags"], "points": shape[0], "holes": shape[1:],
        })

    for osm_id, item in vicinity["nodes"].items():
        if item["tags"].get("railway") == "signal":
            features.append(signal_feature(
                osm_id, item, path, chainages, vicinity["ways"], project,
            ))

    relation = inventory["relations"][str(relation_id)]["tags"]
    world = {
        "service": relation["ref"], "sourceRelation": relation_id, "projection": projection,
        "rail": profile, "sourcePath": path, "spans": spans,
        "terrain": grid, "stations": stations, "features": features,
    }
    if timetable:
        if timetable["line"] != world["service"]:
            raise ValueError("Timetable line does not match the OSM service")
        world["timetable"] = timetable["services"][0]
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix(".partial.json")
    pending.write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")) + "\n")
    pending.replace(output)
    service_length = stations[-1]["stopDistance"] - stations[0]["stopDistance"]
    print(f"{stations[0]['name']} → {stations[-1]['name']}: {service_length:.1f} m, {len(features)} geographic features")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("relation", type=int)
    parser.add_argument("start", type=int)
    parser.add_argument("finish", type=int)
    parser.add_argument("output", type=Path)
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--timetable", type=Path)
    args = parser.parse_args()
    source = json.loads(args.inventory.read_text()) if args.inventory else extract(osm_snapshot(), [args.relation])
    timetable = json.loads(args.timetable.read_text()) if args.timetable else None
    bake(source, args.relation, args.start, args.finish, args.output, timetable)
