"""List railway and passenger-service relations from the pinned OSM extract."""

import argparse
import json
from pathlib import Path

import osmium


class RouteInventory(osmium.SimpleHandler):
    def relation(self, relation: osmium.osm.Relation) -> None:
        tags = dict(relation.tags)
        if tags.get("type") not in {"route", "route_master"}:
            return
        if tags.get("route", tags.get("route_master")) not in {"train", "railway"}:
            return

        print(json.dumps({
            "id": relation.id,
            "tags": tags,
            "members": {
                kind: sum(member.type == kind for member in relation.members)
                for kind in ("n", "w", "r")
            },
        }, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    arguments = parser.parse_args()
    RouteInventory().apply_file(str(arguments.snapshot))
