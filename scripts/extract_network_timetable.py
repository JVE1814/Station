"""Match dated Entur train calls to the audited OSM passenger-station inventory."""

import argparse
from collections import defaultdict
from hashlib import file_digest, sha256
import json
from pathlib import Path
from zipfile import ZipFile

from align import ground_distance
from extract_timetable import rows

SOURCES = {
    "F4": "rb_vyg-aggregated-gtfs.zip",
    "F5": "rb_goa-aggregated-gtfs.zip",
    "F6": "rb_sjn-aggregated-gtfs.zip",
}


def station_associations(stations, archive):
    result = {}
    for place in rows(archive, "stops"):
        if place["vehicle_type"] not in {"2", "100"} or not place["stop_lat"] or not place["stop_lon"]:
            continue
        point = [float(place["stop_lon"]), float(place["stop_lat"])]
        ordered = sorted(
            (ground_distance(point, item["sourcePosition"]), index)
            for index, item in enumerate(stations)
        )
        distance, index = ordered[0]
        if distance > 350:
            continue
        if len(ordered) > 1 and ordered[1][0] - distance < 40:
            continue
        result[place["stop_id"]] = (index, place["stop_name"], round(distance, 2))
    return result


def schedule(service, feed_path, day):
    ref = service["ref"]
    stations = service["stations"]
    with feed_path.open("rb") as stream:
        digest = file_digest(stream, sha256).hexdigest()
    with ZipFile(feed_path) as archive:
        days = {
            item["service_id"] for item in rows(archive, "calendar_dates")
            if item["date"] == day and item["exception_type"] == "1"
        }
        lines = {
            route["route_id"] for route in rows(archive, "routes")
            if route["route_short_name"] == ref and route["route_type"] in {"2", "100"}
        }
        trips = {
            trip["trip_id"]: trip for trip in rows(archive, "trips")
            if trip["route_id"] in lines and trip["service_id"] in days
        }
        association = station_associations(stations, archive)
        calls = defaultdict(list)
        for row in rows(archive, "stop_times"):
            if row["trip_id"] in trips:
                calls[row["trip_id"]].append(row)

    journeys = []
    rejected = []
    for trip, call_list in calls.items():
        ordered = sorted(call_list, key=lambda call: int(call["stop_sequence"]))
        locations = [association.get(call["stop_id"]) for call in ordered]
        if any(location is None for location in locations):
            rejected.append([trip, "unmatched", [call["stop_id"] for call, location in zip(ordered, locations) if location is None]])
            continue
        stops = [location[0] for location in locations]
        if len(stops) < 2:
            continue
        if stops[0] == 0 and stops[-1] == len(stations) - 1:
            direction = 1
        elif stops[0] == len(stations) - 1 and stops[-1] == 0:
            direction = -1
        else:
            continue
        if any((b - a) * direction <= 0 for a, b in zip(stops, stops[1:])):
            rejected.append([trip, "order", stops])
            continue
        journeys.append({
            "trip": trip,
            "headsign": trips[trip]["trip_headsign"],
            "departure": ordered[0]["departure_time"],
            "arrival": ordered[-1]["arrival_time"],
            "direction": direction,
            "calls": [
                {
                    "stationOsmId": stations[index]["osmId"],
                    "name": stations[index]["name"],
                    "gtfsName": gtfs_name,
                    "matchDistance": distance,
                    "sourceStop": call["stop_id"],
                    "arrival": call["arrival_time"],
                    "departure": call["departure_time"],
                }
                for (index, gtfs_name, distance), call in zip(locations, ordered)
            ],
        })

    options = [journey for journey in journeys if journey["direction"] == 1]
    daylight = [journey for journey in options if "07:00" <= journey["departure"] <= "16:00"]
    if not options:
        raise ValueError(f"No complete {ref} Oslo departure matched GTFS source {feed_path}; rejected {rejected[:14]}")
    selected = min(daylight or options, key=lambda item: (-len(item["calls"]), item["departure"]))
    return {
        "line": ref,
        "date": day,
        "source": f"https://storage.googleapis.com/marduk-production/outbound/gtfs/{SOURCES[ref]}",
        "sha256": digest,
        "selected": selected,
        "journeys": sorted(journeys, key=lambda item: item["departure"]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("topology", type=Path)
    parser.add_argument("date")
    parser.add_argument("feed_directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.topology.read_text())
    feed_names = {"F4": "vy", "F5": "goa", "F6": "sjn"}
    result = [
        schedule(item, args.feed_directory / f"{feed_names[item['ref']]}-gtfs.zip", args.date)
        for item in data["services"] if item["ref"] in feed_names
    ]
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    for item in result:
        print(item["line"], len(item["journeys"]), "dated full services, selected",
              item["selected"]["departure"], "with", len(item["selected"]["calls"]), "calls")
