"""Bake static, chainage-indexed scenery tiles from connected OSM routes and Copernicus DEM."""

from argparse import ArgumentParser
from array import array
from bisect import bisect_left, bisect_right
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from itertools import pairwise, product
import gzip
import json
from math import ceil, exp, floor, isfinite
import os
from pathlib import Path
import subprocess

import osmium
from pyproj import CRS, Transformer
from shapely import box, union_all
from shapely.geometry import mapping

from bake_pair import feature_kind, signal_feature, span_metadata
from extract_osm import extract, interesting_way
from grade import constrain_grade
from source_data import CACHE, DEM_ROOT, OSM_SNAPSHOT, elevation_tile, osm_snapshot
from terrain import sample_height, terrain_grid


def write_json(target, value, *, compress=False):
    target.parent.mkdir(exist_ok=True, parents=True)
    temporary = target.with_name(target.name + ".partial")
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    with temporary.open("wb") as raw:
        if compress:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=7) as stream:
                stream.write(data)
        else:
            raw.write(data)
    temporary.replace(target)


def projection_for(topology):
    if topology.get("projection"):
        return topology["projection"]
    services = topology["services"]
    if len(services) == 1 and services[0].get("projection"):
        return services[0]["projection"]
    coordinates = [entry["point"] for service in services for entry in service["sourcePath"]]
    if not coordinates:
        raise ValueError("Topology has no route coordinates")
    longitude, latitude = zip(*coordinates, strict=True)
    return (f"+proj=aeqd +lat_0={sum(latitude) / len(latitude)} "
            f"+lon_0={sum(longitude) / len(longitude)} +datum=WGS84 +units=m")


def projected_alignment(service, ways, projection):
    source = service["sourcePath"]
    if len(source) < 2 or source[0]["distance"] != 0:
        raise ValueError(f"{service['ref']}: route must start at chainage zero and have at least two points")
    crs = CRS.from_user_input(projection)
    project = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    unproject = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform

    route = [(entry["distance"], *project(*entry["point"])) for entry in source]
    spans = []
    way_nodes = {}
    for (start, finish), (previous, entry) in zip(pairwise(route), pairwise(source), strict=True):
        if not all(map(isfinite, (*start, *finish))) or start[0] >= finish[0]:
            raise ValueError(f"{service['ref']}: non-increasing or invalid chainage at OSM node {entry['node']}")
        way_id = entry["way"]
        way = ways[str(way_id)]
        tags = way["tags"]
        if str(way_id) not in way_nodes:
            way_nodes[str(way_id)] = {node: index for index, node in enumerate(way["nodeIds"])}
        node_indices = way_nodes[str(way_id)]
        a, b = node_indices[previous["node"]], node_indices[entry["node"]]
        if abs(b - a) != 1:
            raise ValueError(f"{service['ref']}: disconnected source way {way_id} at OSM node {entry['node']}")
        direction = "forward" if b > a else "backward"
        if spans and spans[-1]["osmWay"] == way_id and spans[-1]["direction"] == direction:
            spans[-1]["end"] = finish[0]
        else:
            span = span_metadata(way_id, tags, start[0], finish[0])
            directed_speed = tags.get(f"maxspeed:{direction}", "")
            if directed_speed.isdecimal():
                span["speedLimit"] = int(directed_speed)
            span.update(start=start[0], end=finish[0], direction=direction, sourceTags=tags)
            spans.append(span)
    return projection, project, unproject, route, spans


def structure_ranges(spans):
    ranges = []
    prior_kind = None
    for span in spans:
        kind = "tunnel" if span["tunnel"] else "bridge" if span["bridge"] else None
        if kind:
            if kind == prior_kind:
                ranges[-1] = ranges[-1][0], span["end"]
            else:
                ranges.append((span["start"], span["end"]))
        prior_kind = kind
    return ranges


def tile_intervals(length, tile_length, structures, stations=()):
    """Do not create fake portals at ends of scenery tiles."""
    protected = []
    station_limits = [(max(0, stop - 100), min(length, stop + 100)) for stop in stations]
    for left, right in sorted([*structures, *station_limits]):
        if protected and left <= protected[-1][1]:
            protected[-1] = protected[-1][0], max(right, protected[-1][1])
        else:
            protected.append((left, right))
    intervals = []
    start = 0.0
    while start < length:
        finish = min(length, start + tile_length)
        for left, right in protected:
            if left < finish < right:
                finish = left if left - start >= 0.7 * tile_length else right
        if length - finish < tile_length * 0.25:
            finish = length
        if finish <= start:
            raise ValueError(f"Non-increasing tile boundary at {start}")
        intervals.append((start, finish))
        start = finish
    return intervals


def point_at(rows, chainages, distance):
    previous_index = bisect_right(chainages, distance) - 1
    if previous_index < 0 or distance > chainages[-1]:
        raise ValueError(f"Chainage {distance} falls outside route")
    previous = rows[previous_index]
    if previous[0] == distance:
        return previous
    next_point = rows[previous_index + 1]
    u = (distance - previous[0]) / (next_point[0] - previous[0])
    return (distance, *(a + (b - a) * u for a, b in zip(previous[1:], next_point[1:], strict=True)))


def portion(rows, chainages, start, end):
    return [
        point_at(rows, chainages, start),
        *rows[bisect_right(chainages, start):bisect_left(chainages, end)],
        point_at(rows, chainages, end),
    ]


def geographic_bounds(bounds, unproject):
    left, bottom, right, top = bounds
    edge = [position / 16 for position in range(17)]
    perimeter = [
        point
        for u in edge
        for point in (
            unproject(left + (right - left) * u, bottom),
            unproject(left + (right - left) * u, top),
            unproject(left, bottom + (top - bottom) * u),
            unproject(right, bottom + (top - bottom) * u),
        )
    ]
    longitudes, latitudes = zip(*perimeter, strict=True)
    return min(latitudes), min(longitudes), max(latitudes), max(longitudes)


def prepare_service(service, ways, projection, tile_length, padding, spacing):
    ref = service["ref"]
    if not ref.isalnum():
        raise ValueError(f"Invalid route reference {ref}")
    projection, project, unproject, route, spans = projected_alignment(service, ways, projection)
    distances = [point[0] for point in route]
    structures = structure_ranges(spans)
    stops = [station["stopDistance"] for station in service["stations"]]
    tiles = []
    for index, (start, end) in enumerate(tile_intervals(distances[-1], tile_length, structures, stops)):
        rows = portion(route, distances, start, end)
        _, east, north = zip(*rows, strict=True)
        bounds = (
            floor((min(east) - padding) / spacing) * spacing,
            floor((min(north) - padding) / spacing) * spacing,
            ceil((max(east) + padding) / spacing) * spacing,
            ceil((max(north) + padding) / spacing) * spacing,
        )
        left, bottom, right, top = bounds
        tiles.append({
            "id": f"{ref}-{index:03d}", "start": start, "end": end, "bounds": bounds,
            "wgs84": geographic_bounds((left - spacing, bottom - spacing, right + spacing, top + spacing), unproject),
        })
    return service, projection, project, route, spans, structures, tiles


def corridor_extract(snapshot, tiles, work, *, force=False):
    if len(tiles) <= 8 and not force:
        return snapshot
    bounds = [tile["wgs84"] for tile in tiles]
    stat = snapshot.stat()
    key = sha256(json.dumps((str(snapshot.resolve()), stat.st_size, stat.st_mtime_ns, bounds)).encode()).hexdigest()[:16]
    result = work / f"corridor-{key}.osm.pbf"
    if result.exists():
        return result
    shape = union_all([box(west, south, east, north) for south, west, north, east in bounds])
    if shape.is_empty:
        raise ValueError("The source corridor is empty")
    polygon = work / f"corridor-{key}.geojson"
    write_json(polygon, {"type": "Feature", "properties": {}, "geometry": mapping(shape)})
    temporary = result.with_name(result.stem + ".partial.osm.pbf")
    print(f"Extracting the OSM corridor for {len(tiles)} tiles", flush=True)
    subprocess.run([
        os.environ.get("OSMIUM_BIN", "osmium"), "extract", "--polygon", str(polygon),
        "--strategy", "smart", "--option", "types=multipolygon", "--no-progress",
        "--overwrite", "--output", str(temporary), str(snapshot),
    ], check=True)
    temporary.replace(result)
    return result




def index_scenery_tiles(snapshot, tiles, work, *, clip=False):
    source = corridor_extract(snapshot, tiles, work, force=clip).resolve()
    stat = source.stat()
    source_id = (str(source), stat.st_size, stat.st_mtime_ns)
    indexed = {}
    pending = defaultdict(list)
    for tile in tiles:
        bounds = tuple(tile["wgs84"])
        key = sha256(json.dumps((source_id, bounds, 2)).encode()).hexdigest()[:16]
        path = work / "scenery" / f"{key}.json"
        indexed[tile["id"]] = path
        if not path.exists() and path not in pending[bounds]:
            pending[bounds].append(path)
    if not pending:
        return indexed

    keys = list(pending)
    tiles_by_cell = defaultdict(list)
    scale = 6

    def bins(south, west, north, east):
        return product(range(floor(south * scale), floor(north * scale) + 1),
                       range(floor(west * scale), floor(east * scale) + 1))

    for index, bounds in enumerate(keys):
        for cell in bins(*bounds):
            tiles_by_cell[cell].append(index)

    def overlapping(points):
        if not points:
            return
        longitude, latitude = zip(*points)
        south, west, north, east = min(latitude), min(longitude), max(latitude), max(longitude)
        possible = {tile for cell in bins(south, west, north, east) for tile in tiles_by_cell.get(cell, ())}
        for tile in sorted(possible):
            y0, x0, y1, x1 = keys[tile]
            if x0 <= east and x1 >= west and y0 <= north and y1 >= south:
                yield tile

    merged_bounds = (
        min(bounds[0] for bounds in keys), min(bounds[1] for bounds in keys),
        max(bounds[2] for bounds in keys), max(bounds[3] for bounds in keys),
    )
    print(f"Indexing OSM features once across {len(keys)} scenery windows", flush=True)
    source_features = local_scenery(source, merged_bounds)
    windows = [{"ways": {}, "nodes": {}, "areas": []} for _ in keys]
    for id_, node in source_features["nodes"].items():
        for target in overlapping([node["point"]]):
            windows[target]["nodes"][id_] = node
    for id_, way in source_features["ways"].items():
        for target in overlapping(way["points"]):
            windows[target]["ways"][id_] = way
    for area in source_features["areas"]:
        for target in overlapping(area["rings"][0]):
            windows[target]["areas"].append(area)

    for bounds, features in zip(keys, windows, strict=True):
        for filename in pending[bounds]:
            write_json(filename, features)
    print(f"Indexed {len(source_features['ways'])} OSM ways for {len(keys)} scenery windows", flush=True)
    return indexed


def prefetch_elevation(tiles):
    cells = set()
    for tile in tiles:
        south, west, north, east = tile["wgs84"]
        cells.update((lat, lon)
                     for lat in range(floor(south), floor(north) + 1)
                     for lon in range(floor(west), floor(east) + 1))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda cell: elevation_tile(*cell), sorted(cells)))


def terrain_for_tile(tile, projection, work, spacing):
    key = sha256(json.dumps((DEM_ROOT, tile["bounds"], projection, spacing)).encode()).hexdigest()[:16]
    folder = work / "terrain" / key
    folder.mkdir(parents=True, exist_ok=True)
    bytes_path = folder / "terrain.bin"
    header_path = folder / "grid.json"
    if header_path.is_file() and bytes_path.is_file():
        grid = json.loads(header_path.read_bytes())
        height_samples = array("f")
        with bytes_path.open("rb") as stream:
            height_samples.fromfile(stream, grid["width"] * grid["height"])
        grid["samples"] = height_samples
        return grid
    grid = terrain_grid(folder, tile["wgs84"], tile["bounds"], projection, spacing)
    write_json(header_path, {key: value for key, value in grid.items() if key != "samples"})
    return grid


def build_profile(route, structures, tiles, grids):
    """Compute and constrain heights once along the entire service to avoid tile seams."""
    rows = []
    tile_ends = [tile["end"] for tile in tiles]
    for index, (a, b) in enumerate(pairwise(route)):
        length = b[0] - a[0]
        divisions = ceil(length / 4)
        for division in range(0 if index == 0 else 1, divisions + 1):
            u = division / divisions
            distance, x, y = b if division == divisions else (
                a[0] + length * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u,
            )
            tile_index = bisect_left(tile_ends, distance)
            rows.append((distance, x, y, sample_height(grids[tile_index], x, y)))
    distances = [point[0] for point in rows]
    for start, end in structures:
        low, high = bisect_left(distances, start), bisect_right(distances, end) - 1
        left, right = rows[low], rows[high]
        for index in range(low + 1, high):
            distance, x, y, _ = rows[index]
            u = (distance - left[0]) / (right[0] - left[0])
            rows[index] = distance, x, y, left[3] + (right[3] - left[3]) * u

    averaged = []
    low = high = 0
    for distance in distances:
        while distances[low] < distance - 60:
            low += 1
        while high < len(rows) and distances[high] <= distance + 60:
            high += 1
        values = [(exp(-0.5 * ((other - distance) / 24) ** 2), height)
                  for other, _, _, height in rows[low:high]]
        averaged.append(sum(weight * height for weight, height in values) / sum(weight for weight, _ in values))
    elevations = constrain_grade(distances, averaged, 0.027)
    return [(d, x, y, z + 0.22) for (d, x, y, _), z in zip(rows, elevations, strict=True)]


def rail_json(rows, start=0.0):
    return [
        {"distance": round(d - start, 4), "east": round(x, 4), "north": round(y, 4), "height": round(z, 4)}
        for d, x, y, z in rows
    ]


def tile_spans(spans, start, end):
    return [
        {**span, "start": round(max(span["start"], start) - start, 4),
         "end": round(min(span["end"], end) - start, 4)}
        for span in spans
        if span["start"] < end and span["end"] > start
    ]


def local_scenery(snapshot, bounds):
    scenery = extract(snapshot, [], bounds)
    factory = osmium.geom.GeoJSONFactory()
    scenery["areas"] = []
    for item in osmium.FileProcessor(str(snapshot)).with_areas():
        if not item.is_area() or item.from_way() or not interesting_way(item.tags):
            continue
        polygons = json.loads(factory.create_multipolygon(item))["coordinates"]
        scenery["areas"].extend({"id": item.orig_id(), "tags": dict(item.tags), "rings": rings}
                                for rings in polygons)
    return scenery


def scenery_features(vicinity, project, active_path, active_ways):
    def project_points(points):
        return [[round(value, 3) for value in project(*point)] for point in points]

    features = []
    for osm_id, item in vicinity["ways"].items():
        kind = feature_kind(item["tags"])
        points = item["points"]
        if kind == "track" and int(osm_id) in active_ways:
            continue
        if kind and len(points) >= (2 if kind == "track" else 3):
            features.append({"osmId": int(osm_id), "type": kind, "tags": item["tags"],
                             "points": project_points(points)})

    for item in vicinity["areas"]:
        kind = feature_kind(item["tags"])
        if kind:
            shape = [project_points(ring) for ring in item["rings"]]
            features.append({"osmId": item["id"], "osmElement": "relation", "type": kind, "tags": item["tags"],
                             "points": shape[0], "holes": shape[1:]})

    occurrences = defaultdict(list)
    for index, entry in enumerate(active_path[:-1]):
        occurrences[entry["node"]].append(index)
    signal_events = []
    for osm_id, item in vicinity["nodes"].items():
        if item["tags"].get("railway") != "signal":
            continue
        passages = []
        for index in occurrences[int(osm_id)]:
            entry = active_path[index]
            passage = signal_feature(osm_id, item, active_path[index:index + 2],
                                     {entry["node"]: entry["distance"]}, vicinity["ways"], project)
            if "chainage" in passage:
                passages.append(passage)
        features.append(passages[0].copy() if passages else signal_feature(
            osm_id, item, [], {}, vicinity["ways"], project,
        ))
        signal_events.extend(passages)
    return features, signal_events


def bake_service(prepared, all_ways, local_inputs, output, work, spacing, compress, elevation=None):
    service, projection, project, route, spans, structures, tiles = prepared
    ref, source = service["ref"], service["sourcePath"]
    grids = [elevation.grid(tile) if elevation else terrain_for_tile(tile, projection, work, spacing)
             for tile in tiles]
    profile = build_profile(route, structures, tiles, grids)
    profile_distances = [row[0] for row in profile]
    source_distances = [entry["distance"] for entry in source]
    stations = [{**station, "position": list(project(*station["sourcePosition"]))} for station in service["stations"]]
    active_ways = {entry["way"] for entry in source[1:]}
    manifest_tiles, signals = [], {}
    suffix = ".json.gz" if compress else ".json"
    path_name = f"network/{ref}/source{suffix}"
    write_json(output / path_name, {
        "sourcePath": source,
        "ways": {str(way): all_ways[str(way)] for way in sorted(active_ways)},
        "relationStops": service["serviceStopIds"],
    }, compress=compress)

    for tile, grid in zip(tiles, grids, strict=True):
        start, end = tile["start"], tile["end"]
        path = source[max(0, bisect_right(source_distances, start) - 1):
                      min(len(source), bisect_left(source_distances, end) + 2)]
        features, events = scenery_features(
            json.loads(local_inputs[tile["id"]].read_bytes()), project, path, active_ways,
        )
        for event in events:
            if start <= event["chainage"] <= end:
                signals[event["osmId"], event["chainage"]] = event
        for feature in features:
            if "chainage" in feature:
                if start <= feature["chainage"] <= end:
                    feature["chainage"] = round(feature["chainage"] - start, 4)
                else:
                    feature.pop("chainage")
                    feature.pop("facesService")
        filename = f"network/{ref}/{tile['id']}{suffix}"
        payload = {
            "service": ref, "projection": projection, "start": start, "end": end,
            "rail": rail_json(portion(profile, profile_distances, start, end), start),
            "spans": tile_spans(spans, start, end),
            "stations": [{**station, "stopDistance": round(station["stopDistance"] - start, 4)}
                         for station in stations if start <= station["stopDistance"] <= end],
            "terrain": {**grid, "samples": [round(height, 3) for height in grid["samples"]]},
            "features": features,
        }
        if "timetable" in service:
            payload["timetable"] = service["timetable"]
        write_json(output / filename, payload, compress=compress)
        manifest_tiles.append({**tile, "url": filename})
        print(f"{tile['id']}: {end - start:.0f} m track, {len(features)} OSM features", flush=True)
    manifest = {
        "ref": ref, "projection": projection, "length": profile_distances[-1],
        "stations": stations, "rail": rail_json(profile), "spans": spans,
        "features": sorted(signals.values(), key=lambda feature: feature["chainage"]),
        "tiles": manifest_tiles, "sourcePathUrl": path_name,
    }
    for key in ("sourceRelation", "timetable"):
        if key in service:
            manifest[key] = service[key]
    return manifest


def bake_network(topology, snapshot, output, work, *, tile_length, padding, spacing, compress, elevation=None, clip_scenery=False):
    if not all(isfinite(n) and n > 0 for n in (tile_length, padding, spacing)) or padding <= 2 * spacing:
        raise ValueError("Positive tile length and terrain spacing are required, with padding over two samples")
    work.mkdir(parents=True, exist_ok=True)
    refs = [service["ref"] for service in topology["services"]]
    if not refs or len(set(refs)) != len(refs):
        raise ValueError("Topology must have unique service references")
    projection = projection_for(topology)
    prepared = [prepare_service(service, topology["ways"], projection, tile_length, padding, spacing)
                for service in topology["services"]]
    tiles = [tile for service in prepared for tile in service[-1]]
    with ThreadPoolExecutor(max_workers=2) as workers:
        ready = (workers.submit(elevation.prefetch, tiles, projection, work, spacing)
                 if elevation else workers.submit(prefetch_elevation, tiles))
        local_inputs = index_scenery_tiles(snapshot, tiles, work, clip=clip_scenery)
        ready.result()
    manifest = {
        "version": 1, "projection": projection, "osmSnapshot": OSM_SNAPSHOT, "elevationSource": elevation.source if elevation else DEM_ROOT,
        "services": [bake_service(service, topology["ways"], local_inputs, output, work, spacing, compress, elevation)
                     for service in prepared],
    }
    write_json(output / "network.json", manifest)


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("topology", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    parser.add_argument("--work", type=Path, default=CACHE / "network-tiles")
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--tile-length", type=float, default=9600)
    parser.add_argument("--padding", type=float, default=1200)
    parser.add_argument("--spacing", type=int, default=30)
    parser.add_argument("--plain", action="store_true", help="Write tile JSON without gzip compression")
    args = parser.parse_args()
    bake_network(json.loads(args.topology.read_bytes()), args.snapshot or osm_snapshot(), args.output, args.work,
                 tile_length=args.tile_length, padding=args.padding, spacing=args.spacing, compress=not args.plain)
