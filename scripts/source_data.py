"""Fetch the immutable OSM snapshot and the elevation tiles needed by a corridor."""

import math
import subprocess
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / ".cache"
OSM_SNAPSHOT = "https://download.geofabrik.de/europe/norway-261117.osm.pbf"
DEM_ROOT = "https://copernicus-dem-30m.s3.amazonaws.com"


def download(url: str, name: str, expected_size: int | None = None) -> Path:
    CACHE.mkdir(exist_ok=True)
    target = CACHE / name
    if target.is_file() and (expected_size is None or target.stat().st_size == expected_size):
        return target

    pending = target.with_suffix(target.suffix + ".partial")
    subprocess.run(
        ["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
         "--silent", "--show-error", "--output", str(pending), url],
        check=True,
    )
    if expected_size is not None and pending.stat().st_size != expected_size:
        raise ValueError(f"Wrong size for {url}: {pending.stat().st_size}")
    pending.replace(target)
    return target


def osm_snapshot() -> Path:
    return download(OSM_SNAPSHOT, "norway.osm.pbf", 1_379_175_391)


def elevation_tile(lat: int, lon: int) -> Path:
    latitude = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
    longitude = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
    tile = f"Copernicus_DSM_COG_10_{latitude}_00_{longitude}_00_DEM"
    return download(f"{DEM_ROOT}/{tile}/{tile}.tif", f"{latitude}{longitude}.tif")


def elevation_tiles(south: float, west: float, north: float, east: float) -> list[Path]:
    return [
        elevation_tile(lat, lon)
        for lat in range(math.floor(south), math.floor(north) + 1)
        for lon in range(math.floor(west), math.floor(east) + 1)
    ]


if __name__ == "__main__":
    print(osm_snapshot())
