"""Extract nearby Voss street centrelines for the R40 showpiece."""

from argparse import ArgumentParser
import json
from pathlib import Path
import re

import osmium
from pyproj import Transformer
from shapely import LineString, Point

from bake_network_tiles import corridor_extract, write_json
from source_data import CACHE, OSM_SNAPSHOT, osm_snapshot


ROOT = Path(__file__).resolve().parents[1]
R40 = ROOT / "public/data/r40"
RADIUS = 500
ROAD_WIDTHS = {
    "trunk": 7.2, "trunk_link": 5.5, "primary": 7.0, "primary_link": 5.5,
    "secondary": 6.6, "secondary_link": 5.0, "tertiary": 6.0, "tertiary_link": 4.8,
    "unclassified": 4.6, "residential": 4.8, "living_street": 4.2,
}
ACCESS_WIDTHS = {"service": 3.2, "pedestrian": 3.2, "track": 2.7}
PATH_WIDTHS = {"footway": 1.7, "cycleway": 2.1, "path": 1.3}
WIDTH = re.compile(r"^([0-9]+(?:[.,][0-9]+)?)\s*(?:m)?$")
SURFACE_TAGS = ("highway", "name", "ref", "surface", "service", "width",
                "lanes", "footway", "bicycle", "access", "lit")


def ground_level(tags):
    return (tags.get("bridge", "no") == "no" and tags.get("tunnel", "no") == "no"
            and tags.get("layer", "0") == "0" and tags.get("area", "no") != "yes"
            and tags.get("indoor", "no") != "yes" and tags.get("covered", "no") != "yes"
            and tags.get("location") not in {"underground", "overground"}
            and tags.get("service") != "drive-through")


def road_width(tags, kind, standard):
    if specified := WIDTH.fullmatch(tags.get("width", "").strip()):
        metres = float(specified[1].replace(",", "."))
        if 0.5 <= metres <= 20:
            return metres
    lanes = tags.get("lanes", "")
    if kind == "road" and lanes.isdecimal() and 1 <= int(lanes) <= 6:
        return round(int(lanes) * 3.1, 2)
    if kind == "access" and tags.get("service") in {"driveway", "parking_aisle"}:
        return 2.6 if tags["service"] == "driveway" else 3.8
    return standard


def line_parts(geometry):
    if geometry.geom_type == "LineString":
        if geometry.length >= 2:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from line_parts(part)


def extract_streets(snapshot, projection, station):
    project = Transformer.from_crs("EPSG:4326", projection, always_xy=True).transform
    center = tuple(station["position"])
    extent = Point(center).buffer(RADIUS, quad_segs=32)
    west, south, east, north = extent.bounds
    classes = {
        **{highway: ("road", width) for highway, width in ROAD_WIDTHS.items()},
        **{highway: ("access", width) for highway, width in ACCESS_WIDTHS.items()},
        **{highway: ("path", width) for highway, width in PATH_WIDTHS.items()},
    }
    tag_filter = osmium.filter.TagFilter(*[("highway", highway) for highway in classes])
    processor = osmium.FileProcessor(str(snapshot), osmium.osm.NODE | osmium.osm.WAY)
    processor.with_locations().with_filter(tag_filter)
    streets = []
    for way in processor:
        if not way.is_way() or not ground_level(way.tags):
            continue
        points = [project(node.location.lon, node.location.lat) for node in way.nodes if node.location.valid()]
        if len(points) < 2:
            continue
        if len(points) != len(way.nodes):
            raise ValueError(f"Source highway {way.id} is missing OSM node geometry")
        x, y = zip(*points, strict=True)
        if max(x) < west or min(x) > east or max(y) < south or min(y) > north:
            continue
        kind, standard = classes[way.tags["highway"]]
        width = road_width(way.tags, kind, standard)
        tags = {key: way.tags[key] for key in SURFACE_TAGS if key in way.tags}
        portions = sorted(line_parts(LineString(points).intersection(extent)), key=lambda part: part.bounds)
        for index, part in enumerate(portions):
            streets.append({
                "osmId": way.id, "part": index, "kind": kind,
                "points": [[round(e, 3), round(n, 3)] for e, n in part.coords],
                "widthMetres": width, "tags": tags,
            })
    return {
        "version": 1, "projection": projection, "osmSnapshot": OSM_SNAPSHOT,
        "stationOsmId": station["osmId"], "center": center, "radiusMetres": RADIUS,
        "streets": sorted(streets, key=lambda street: (street["osmId"], street["part"])),
    }


def bake_voss_streets(manifest_path, output, *, snapshot=None, source_extract=None, work=CACHE / "r40-evanger"):
    manifest = json.loads(manifest_path.read_bytes())
    service = next(service for service in manifest["services"] if service["ref"] == "R40")
    station = next(station for station in service["stations"] if station["name"] == "Voss")
    work.mkdir(parents=True, exist_ok=True)
    source = source_extract or corridor_extract(snapshot or osm_snapshot(), service["tiles"], work, force=True)
    sidecar = extract_streets(source, manifest["projection"], station)
    if not sidecar["streets"]:
        raise ValueError("The source extract has no surface street centrelines near Voss")
    write_json(output, sidecar)
    print(f"Voss: {len(sidecar['streets'])} street and access segments within {RADIUS} m")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=R40 / "network.json")
    parser.add_argument("--source-extract", type=Path, help="Use an existing exact R40 extract of the pinned OSM snapshot")
    parser.add_argument("--output", type=Path, default=R40 / "voss-streets.json")
    args = parser.parse_args()
    bake_voss_streets(args.manifest, args.output, source_extract=args.source_extract)


if __name__ == "__main__":
    main()
