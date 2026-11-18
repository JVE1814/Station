"""Export scheduled times for an OSM corridor from a dated Entur GTFS feed."""

import argparse
from collections import defaultdict
import csv
from hashlib import sha256
import io
import json
from pathlib import Path
from zipfile import ZipFile


def rows(archive, table):
    with archive.open(f"{table}.txt") as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def timetable(path, day, line, start_name, end_name):
    with ZipFile(path) as archive:
        source = next(rows(archive, "feed_info"))
        dates = {
            row["service_id"] for row in rows(archive, "calendar_dates")
            if row["date"] == day and row["exception_type"] == "1"
        }
        routes = {
            row["route_id"] for row in rows(archive, "routes")
            if row["route_short_name"] == line and row["route_type"] in {"2", "100"}
        }
        trips = {
            row["trip_id"]: row for row in rows(archive, "trips")
            if row["route_id"] in routes and row["service_id"] in dates
        }
        platforms = {
            row["stop_id"]: row["stop_name"] for row in rows(archive, "stops")
            if row["vehicle_type"] in {"2", "100"} and row["stop_name"] in {start_name, end_name}
        }
        movement = defaultdict(list)
        for row in rows(archive, "stop_times"):
            if row["trip_id"] in trips and row["stop_id"] in platforms:
                movement[row["trip_id"]].append(row)

    services = []
    for trip, calls in movement.items():
        ordered = sorted(calls, key=lambda call: int(call["stop_sequence"]))
        if len(ordered) != 2:
            continue
        start, end = ordered
        if platforms[start["stop_id"]] == start_name and platforms[end["stop_id"]] == end_name:
            services.append({
                "trip": trip,
                "headsign": trips[trip]["trip_headsign"],
                "departure": start["departure_time"],
                "arrival": end["arrival_time"],
            })

    if not services:
        raise ValueError(f"No {line} service from {start_name} to {end_name} on {day}")
    with path.open("rb") as stream:
        from hashlib import file_digest
        digest = file_digest(stream, sha256).hexdigest()
    return {
        "date": day, "feed": source, "sha256": digest,
        "line": line, "from": start_name, "to": end_name,
        "services": sorted(services, key=lambda service: service["departure"]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("feed", type=Path)
    parser.add_argument("day")
    parser.add_argument("line")
    parser.add_argument("from_station")
    parser.add_argument("to_station")
    args = parser.parse_args()
    print(json.dumps(timetable(args.feed, args.day, args.line, args.from_station, args.to_station),
                     ensure_ascii=False, indent=2))
