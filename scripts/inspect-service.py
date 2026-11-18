"""Report service stops and alignment gaps from extracted OSM relations."""

import argparse
import json
from itertools import pairwise
from pathlib import Path

from align import alignment


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text())
    for key, relation in inventory["relations"].items():
        stops = [
            node for kind, node, role in relation["members"]
            if kind == "n" and role.startswith("stop")
        ]
        print(key, relation["tags"].get("name", relation["tags"].get("description")))
        for start, finish in pairwise(stops):
            from_stop = inventory["nodes"][str(start)]
            to_stop = inventory["nodes"][str(finish)]
            try:
                path = alignment(inventory, int(key), start, finish)
                result = f"{path[-1]['distance']:9.1f} m"
            except ValueError as exception:
                result = str(exception)
            print(start, from_stop["tags"].get("name"), "→", finish, to_stop["tags"].get("name"), result)
