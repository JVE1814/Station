"""Export selected relation members and corridor features with original OSM IDs."""

import argparse
import json
import os
from pathlib import Path
import subprocess

import osmium

from source_data import osm_snapshot


class Relations(osmium.SimpleHandler):
    def __init__(self, ids: list[int]) -> None:
        super().__init__()
        self.ids = set(ids)
        self.data = {}

    def relation(self, relation: osmium.osm.Relation) -> None:
        if relation.id in self.ids:
            self.data[relation.id] = {
                "tags": dict(relation.tags),
                "members": [[member.type, member.ref, member.role] for member in relation.members],
            }


def interesting_way(tags: osmium.osm.TagList) -> bool:
    return (
        "building" in tags
        or tags.get("landuse") in {"forest", "reservoir"}
        or tags.get("natural") in {"water", "wood"}
        or tags.get("waterway") in {"river", "stream", "canal", "riverbank"}
        or tags.get("railway") in {"rail", "platform"}
        or tags.get("public_transport") == "platform"
    )


class Features(osmium.SimpleHandler):
    def __init__(self, relations: dict, bounds: tuple | None) -> None:
        super().__init__()
        self.ways = {}
        self.nodes = {}
        self.bounds = bounds
        members = [member for relation in relations.values() for member in relation["members"]]
        self.way_ids = {ref for kind, ref, _ in members if kind == "w"}
        self.node_ids = {ref for kind, ref, _ in members if kind == "n"}

    def intersects(self, points: list) -> bool:
        if not self.bounds or not points:
            return False
        south, west, north, east = self.bounds
        longitude, latitude = zip(*points)
        return min(latitude) <= north and max(latitude) >= south and min(longitude) <= east and max(longitude) >= west

    def node(self, node: osmium.osm.Node) -> None:
        if node.id not in self.node_ids and (
            not self.bounds or node.tags.get("railway") not in {"station", "halt", "signal"}
        ):
            return
        tags = dict(node.tags)
        point = [node.location.lon, node.location.lat]
        if node.id in self.node_ids or (
            tags.get("railway") in {"station", "halt", "signal"} and self.intersects([point])
        ):
            self.nodes[node.id] = {"tags": tags, "point": point}

    def way(self, way: osmium.osm.Way) -> None:
        if way.id not in self.way_ids and (not self.bounds or not interesting_way(way.tags)):
            return

        if any(not node.location.valid() for node in way.nodes):
            if way.id in self.way_ids:
                raise ValueError(f"OSM way {way.id} references a node outside the source extract")
            return

        points = [[node.location.lon, node.location.lat] for node in way.nodes]
        if way.id in self.way_ids or self.intersects(points):
            self.ways[way.id] = {
                "tags": dict(way.tags),
                "nodeIds": [node.ref for node in way.nodes],
                "points": points,
            }


def extract(snapshot: Path, ids: list[int], bounds: tuple | None = None) -> dict:
    relations = Relations(ids)
    for relation in osmium.FileProcessor(str(snapshot), osmium.osm.RELATION):
        relations.relation(relation)
    missing = relations.ids - relations.data.keys()
    if missing:
        raise ValueError(f"Missing OSM relations: {sorted(missing)}")
    features = Features(relations.data, bounds)
    processor = osmium.FileProcessor(
        str(snapshot), osmium.osm.NODE | osmium.osm.WAY,
    ).with_locations("flex_mem")
    if bounds is None:
        processor.with_filter(osmium.filter.IdFilter(features.way_ids | features.node_ids))
    else:
        processor.with_filter(osmium.filter.EmptyTagFilter())
    for feature in processor:
        if feature.is_node():
            features.node(feature)
        else:
            features.way(feature)
    if missing_ways := features.way_ids - features.ways.keys():
        raise ValueError(f"Missing OSM relation ways: {sorted(missing_ways)}")
    if missing_nodes := features.node_ids - features.nodes.keys():
        raise ValueError(f"Missing OSM relation nodes: {sorted(missing_nodes)}")
    return {
        "relations": {str(key): value for key, value in relations.data.items()},
        "ways": {str(key): value for key, value in features.ways.items()},
        "nodes": {str(key): value for key, value in features.nodes.items()},
    }


def extract_vicinity(snapshot: Path, bounds: tuple, work: Path) -> dict:
    southern, western, northern, eastern = bounds
    bounding_box = ",".join(str(coordinate) for coordinate in (western, southern, eastern, northern))
    local = work / "vicinity.osm.pbf"
    if not local.exists():
        pending = work / "vicinity.partial.osm.pbf"
        subprocess.run([
            os.environ.get("OSMIUM_BIN", "osmium"), "extract",
            "--strategy", "smart", "--option", "types=multipolygon",
            "--bbox", bounding_box, "--no-progress", "--overwrite",
            "--output", str(pending), str(snapshot),
        ], check=True)
        pending.replace(local)

    scenery = extract(local, [], bounds)
    factory = osmium.geom.GeoJSONFactory()
    areas = []
    processor = osmium.FileProcessor(str(local)).with_areas()
    for obj in processor:
        if not obj.is_area() or obj.from_way() or not interesting_way(obj.tags):
            continue
        coordinates = json.loads(factory.create_multipolygon(obj))["coordinates"]
        for rings in coordinates:
            areas.append({"id": obj.orig_id(), "tags": dict(obj.tags), "rings": rings})
    scenery["areas"] = areas
    return scenery


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("S", "W", "N", "E"))
    parser.add_argument("relations", type=int, nargs="+")
    args = parser.parse_args()
    result = extract(args.snapshot or osm_snapshot(), args.relations, args.bounds)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
