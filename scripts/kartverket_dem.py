"""Query Kartverket's open 1 m bare-earth DTM and warp only requested windows."""

from array import array
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import os
import subprocess
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

from shapely import Polygon, box, union_all

from bake_network_tiles import write_json
from source_data import download


DTM1_FEED = "https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/datasett/DTM1.atom"
ATOM_NAMES = {"atom": "http://www.w3.org/2005/Atom", "georss": "http://www.georss.org/georss"}
ENVIRONMENT = {
    **os.environ,
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_TIMEOUT": "30",
    "GDAL_HTTP_MAX_RETRY": "2",
    "GDAL_CACHEMAX": "128",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
}


def atom_tiles():
    feed = ET.parse(download(DTM1_FEED, "r40-kartverket-dtm1.atom"))
    for entry in feed.findall("atom:entry", ATOM_NAMES):
        text = entry.findtext("georss:polygon", namespaces=ATOM_NAMES)
        if not text:
            continue
        xy = list(map(float, text.split()))
        footprint = Polygon([(lon, lat) for lat, lon in zip(xy[::2], xy[1::2], strict=True)])
        link = entry.find("atom:link[@rel='section']", ATOM_NAMES)
        if link is None or link.get("type") != "application/geotiff":
            continue
        url = link.get("href")
        if urlparse(url).hostname != "nedlasting.geonorge.no":
            raise ValueError(f"Unexpected Kartverket source host on {url}")
        yield footprint, {"url": url, "id": link.get("title"),
                          "feedUpdated": entry.findtext("atom:updated", namespaces=ATOM_NAMES)}


def source_revision(record):
    output = subprocess.run(["curl", "-fsSLI", "--retry", "2", "--connect-timeout", "15", "--max-time", "45",
                             record["url"]], capture_output=True, check=True, text=True)
    headers = {}
    for row in output.stdout.splitlines():
        if row.startswith("HTTP/"):
            headers.clear()
        elif ":" in row:
            key, value = row.split(":", 1)
            headers[key.lower()] = value.strip()
    if headers.get("accept-ranges") != "bytes" or not headers.get("etag"):
        raise ValueError(f"Kartverket DTM revision or byte-range access unavailable at {record['url']}")
    return {**record, "etag": headers["etag"], "lastModified": headers.get("last-modified"),
            "bytes": int(headers["content-length"])}


def covered(tile, polygons):
    south, west, north, east = tile["wgs84"]
    shape = box(west, south, east, north)
    return [record for footprint, record in polygons if footprint.intersects(shape)]


class KartverketElevation:
    source = DTM1_FEED

    def __init__(self, provenance):
        self.provenance = provenance
        self.inputs = {}
        self.revisions = []
        self.grids = {}

    def prefetch(self, tiles, projection, work, spacing):
        points = self.match_sources(tiles)
        revisions = {record["url"]: record for record in self.revisions}
        with ThreadPoolExecutor(max_workers=3) as pool:
            grids = pool.map(
                lambda tile: self.window(tile, [revisions[record["url"]] for record in points[tile["id"]]],
                                         projection, work, spacing),
                tiles,
            )
            self.grids = {tile["id"]: grid for tile, grid in zip(tiles, grids, strict=True)}

    def match_sources(self, tiles):
        polygons = list(atom_tiles())
        self.inputs = {tile["id"]: covered(tile, polygons) for tile in tiles}
        for tile in tiles:
            if not self.inputs[tile["id"]]:
                raise ValueError(f"No Kartverket DTM1 coverage for {tile['id']}")
            ids = {record["id"] for record in self.inputs[tile["id"]]}
            footprint = union_all([shape for shape, record in polygons if record["id"] in ids])
            south, west, north, east = tile["wgs84"]
            if not footprint.covers(box(west, south, east, north)):
                raise ValueError(f"Incomplete Kartverket ATOM footprints for {tile['id']}")
        unique = {record["url"]: record for records in self.inputs.values() for record in records}
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.revisions = list(pool.map(source_revision, [unique[key] for key in sorted(unique)]))
        evidence = {
            "feed": DTM1_FEED, "license": "NLOD 2.0", "raster": "Kartverket DTM1 bare-earth terrain",
            "sourcePixelSizeMetres": 1, "sources": self.revisions,
        }
        if self.provenance.exists():
            tracked = json.loads(self.provenance.read_text())
            if tracked != evidence:
                raise ValueError(
                    f"Kartverket revised its source tiles. Review {self.provenance} and regenerate source provenance."
                )
        else:
            write_json(self.provenance, evidence)
        return self.inputs

    def grid(self, tile):
        return self.grids[tile["id"]]

    @staticmethod
    def window(tile, sources, projection, work, spacing):
        left, bottom, right, top = tile["bounds"]
        grid = {
            "east": left + spacing / 2, "north": top - spacing / 2, "spacing": spacing,
            "width": round((right - left) / spacing), "height": round((top - bottom) / spacing),
        }
        key = sha256(json.dumps((sources, tile["bounds"], projection, spacing)).encode()).hexdigest()[:20]
        folder = work / "kartverket" / key
        folder.mkdir(parents=True, exist_ok=True)
        raw = folder / "terrain.bin"
        expected = grid["width"] * grid["height"]
        if not raw.exists() or raw.stat().st_size != expected * 4:
            warped = folder / "window.partial.tif"
            output = folder / "window.partial.bin"
            subprocess.run([
                "gdalwarp", "-q", "-overwrite", "-t_srs", projection, "-r", "bilinear", "-ovr", "AUTO",
                "-te", *map(str, tile["bounds"]), "-tr", str(spacing), str(spacing),
                "-ot", "Float32", "-dstnodata", "-9999", "-of", "GTiff",
                *[f"/vsicurl/{record['url']}" for record in sources], str(warped),
            ], env=ENVIRONMENT, check=True)
            subprocess.run(["gdal_translate", "-q", "-of", "ENVI", str(warped), str(output)], check=True)
            if output.stat().st_size != expected * 4:
                raise ValueError(f"Wrong Kartverket raster byte count for {tile['id']}")
            output.replace(raw)
            warped.unlink()
        heights = array("f")
        with raw.open("rb") as stream:
            heights.fromfile(stream, expected)
        if any(not -100 < z < 6000 for z in heights):
            raw.unlink()
            raise ValueError(f"Kartverket DTM1 contains missing elevation inside {tile['id']}")
        return {**grid, "samples": heights}
