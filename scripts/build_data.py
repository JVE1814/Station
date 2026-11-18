"""Bake and install the reference service and dated intercity network assets."""

import json
from pathlib import Path
import shutil
import subprocess
import sys

from bake_network_tiles import write_json as write_bake
from pyproj import Transformer
from shapely import LineString

from source_data import CACHE

ROOT = Path(__file__).resolve().parents[1]


def run(*arguments):
    subprocess.run([sys.executable, *map(str, arguments)], cwd=ROOT, check=True)


def write_json(path, value):
    pending = path.with_suffix(".partial.json")
    pending.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    pending.replace(path)


def publish(staged):
    output = ROOT / "public" / "data"
    network = json.loads((staged / "network.json").read_text())
    calls = json.loads((ROOT / "data" / "network-timetables.json").read_text())
    shutil.copytree(staged / "network", output / "network", dirs_exist_ok=True)
    write_json(output / "timetables.json", calls)
    write_json(output / "network.json", network)
    pair = json.loads((output / "service.json").read_text())
    transform = Transformer.from_crs(network["projection"], pair["projection"], always_xy=True)
    outline = []
    for service in network["services"]:
        x, y = transform.transform([point["east"] for point in service["rail"]],
                                   [point["north"] for point in service["rail"]])
        coordinates = LineString(zip(x, y)).simplify(3.0, preserve_topology=False).coords
        outline.append({
            "ref": service["ref"],
            "rail": [{"east": round(east, 3), "north": round(north, 3)} for east, north in coordinates],
            "stations": [{"osmId": station["osmId"], "name": station["name"],
                          "position": transform.transform(*station["position"])}
                         for station in service["stations"]],
        })
    write_bake(output / "overview-r40.json.gz", outline, compress=True)
    catalog = [
        {
            "ref": service.get("ref", service.get("service")),
            "name": f"{service['stations'][0]['name']} → {service['stations'][-1]['name']}",
        }
        for service in [pair, *network["services"]]
    ]
    write_json(ROOT / "data" / "route-catalog.json", catalog)


if __name__ == "__main__":
    CACHE.mkdir(exist_ok=True)
    run("scripts/bake_pair.py", 18567357, 432630619, 5594658999, "public/data/service.json",
        "--timetable", "data/r40-timetable.json")
    topology = CACHE / "network-topology.json"
    run("scripts/network_alignment.py", topology)
    services = json.loads(topology.read_text())
    timetables = json.loads((ROOT / "data" / "network-timetables.json").read_text())
    selected = {entry["line"]: entry["selected"] for entry in timetables}
    for service in services["services"]:
        service["timetable"] = selected[service["ref"]]
    dated = CACHE / "network-topology-scheduled.json"
    write_json(dated, services)
    staged = CACHE / "network-full"
    run("scripts/bake_network_tiles.py", dated, "--output", staged, "--work", CACHE / "network-full-work")
    publish(staged)
