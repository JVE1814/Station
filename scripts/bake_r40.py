"""Bake the Evanger–Voss service on its OSM alignment and dated Entur timetable."""

import argparse
from collections import defaultdict
from hashlib import file_digest
import json
from pathlib import Path
from zipfile import ZipFile

from bake_network_tiles import bake_network, write_json
from bake_voss_streets import bake_voss_streets
from extract_network_timetable import station_associations
from extract_osm import extract
from extract_timetable import rows
from kartverket_dem import KartverketElevation
from network_alignment import distance, landmark, mapped_stops, osmium_extract, route_alignment
from source_data import CACHE, osm_snapshot


ROOT = Path(__file__).resolve().parents[1]
RELATION = 18567357
START = 431921002
FINISH = 4893194280
SOURCE = "https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_vyg-aggregated-gtfs.zip"
SCHEDULE = ROOT / "data/r40-evanger-timetable.json"
PROVENANCE_DATE = "20261118"


def topology(inventory, catalog):
    line, indices, _, _ = route_alignment(inventory, RELATION, ())
    first, last = indices[START], indices[FINISH]
    selected = [(key, index) for key, index in indices.items() if first <= index <= last]
    before = line[first]["distance"]
    after = line[last]["distance"]
    low = max((index for index, item in enumerate(line[:first]) if item["distance"] <= before - 105), default=0)
    high = next((index for index in range(last + 1, len(line)) if line[index]["distance"] >= after + 100), len(line) - 1)
    base = line[low]["distance"]
    path = [{**item, "distance": round(item["distance"] - base, 4)} for item in line[low:high + 1]]
    path[0]["way"] = None

    nodes, groups = mapped_stops(catalog)
    landmarks = {
        osm_id: node for osm_id, node in nodes.items()
        if node["tags"].get("railway") in {"station", "halt"} and node["tags"].get("name")
    }
    stations = []
    for call, index in selected:
        source = inventory["nodes"][str(call)]
        osm_id, station = landmark(call, source, landmarks, nodes, groups)
        if osm_id == call or distance(source["point"], station["point"]) > 350:
            raise ValueError(f"No OSM railway station/halt matched source R40 call {call}")
        stations.append({
            "name": station["tags"]["name"], "osmId": osm_id, "sourcePosition": station["point"],
            "sourceTags": station["tags"], "stopOsmId": call, "serviceStop": True,
            "servedBy": ["R40"], "stopDistance": round(line[index]["distance"] - base, 4),
        })
    active = {str(item["way"]) for item in path[1:]}
    return {
        "services": [{
            "ref": "R40", "sourceRelation": RELATION, "sourcePath": path, "stations": stations,
            "serviceStopIds": [key for key, _ in selected],
        }],
        "ways": {key: inventory["ways"][key] for key in sorted(active)},
    }


def dated_timetable(stations, feed, day):
    with feed.open("rb") as payload:
        digest = file_digest(payload, "sha256").hexdigest()
    with ZipFile(feed) as archive:
        days = {
            row["service_id"] for row in rows(archive, "calendar_dates")
            if row["date"] == day and row["exception_type"] == "1"
        }
        routes = {
            row["route_id"] for row in rows(archive, "routes")
            if row["route_short_name"] == "R40" and row["route_type"] in {"2", "100"}
        }
        trips = {
            row["trip_id"]: row["trip_headsign"] for row in rows(archive, "trips")
            if row["service_id"] in days and row["route_id"] in routes
        }
        associated = station_associations(stations, archive)
        by_trip = defaultdict(list)
        for row in rows(archive, "stop_times"):
            if row["trip_id"] not in trips or row["stop_id"] not in associated:
                continue
            index, name, gap = associated[row["stop_id"]]
            by_trip[row["trip_id"]].append((int(row["stop_sequence"]), index, {
                "stationOsmId": stations[index]["osmId"], "name": stations[index]["name"],
                "gtfsName": name, "matchDistance": gap, "sourceStop": row["stop_id"],
                "arrival": row["arrival_time"], "departure": row["departure_time"],
            }))

    journeys = []
    for trip, entries in sorted(by_trip.items()):
        ordered = sorted(entries)
        indices = [index for _, index, _ in ordered]
        if len(indices) < 2 or set((indices[0], indices[-1])) != {0, len(stations) - 1}:
            continue
        direction = 1 if indices[0] == 0 else -1
        if any((b - a) * direction <= 0 for a, b in zip(indices, indices[1:])):
            raise ValueError(f"Entur trip {trip} uses non-monotonic stops in Evanger–Voss")
        calls = [call for _, _, call in ordered]
        journeys.append({
            "trip": trip, "headsign": trips[trip], "departure": calls[0]["departure"],
            "arrival": calls[-1]["arrival"], "direction": direction, "calls": calls,
        })
    candidates = [item for item in journeys if item["direction"] == 1 and len(item["calls"]) == len(stations)]
    if not candidates:
        raise ValueError(f"No dated R40 journey from Evanger to Voss calls at all {len(stations)} stations")
    selected = min(candidates, key=lambda item: item["departure"])
    return {
        "line": "R40", "date": day, "source": SOURCE, "sha256": digest,
        "selected": selected, "journeys": sorted(journeys, key=lambda item: item["departure"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--feed", type=Path, help="Refresh the committed timetable from this dated Entur VYG archive")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/r40")
    parser.add_argument("--work", type=Path, default=CACHE / "r40-evanger")
    parser.add_argument("--topology-only", action="store_true")
    parser.add_argument("--dem", choices=["kartverket", "copernicus"], default="kartverket")
    args = parser.parse_args()
    snapshot = args.snapshot or osm_snapshot()
    catalog = args.catalog or osmium_extract(CACHE / "network-stops.osm.pbf", [
        "tags-filter", "-R", str(snapshot), "n/railway=station,halt",
        "n/public_transport=stop_position", "r/public_transport=stop_area",
    ])
    inventory = json.loads(args.inventory.read_text()) if args.inventory else extract(snapshot, [RELATION])
    route = topology(inventory, catalog)
    service = route["services"][0]
    if args.feed:
        dated = dated_timetable(service["stations"], args.feed, PROVENANCE_DATE)
        write_json(SCHEDULE, dated)
    else:
        dated = json.loads(SCHEDULE.read_text())
    service["timetable"] = dated["selected"]
    write_json(args.work / "topology.json", route)
    print(" → ".join(station["name"] for station in service["stations"]),
          dated["selected"]["departure"], dated["selected"]["arrival"], flush=True)
    if args.topology_only:
        return
    elevation = KartverketElevation(ROOT / "data/r40-kartverket-source.json") if args.dem == "kartverket" else None
    spacing = 8 if elevation else 16
    bake_network(route, snapshot, args.output, args.work, tile_length=3600, padding=1850, spacing=spacing,
                 compress=True, elevation=elevation, clip_scenery=True)
    write_json(args.output / "timetables.json", [dated])
    bake_voss_streets(args.output / "network.json", args.output / "voss-streets.json",
                     snapshot=snapshot, work=args.work)


if __name__ == "__main__":
    main()
