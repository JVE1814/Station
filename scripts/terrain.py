"""Read and resample Copernicus DEM into a local metric grid."""

from array import array
from math import ceil, floor
from pathlib import Path
import subprocess

from source_data import elevation_tiles


def run_gdal(tool: str, *arguments: str) -> None:
    subprocess.run([tool, "-q", *map(str, arguments)], check=True)


def terrain_grid(
    directory: Path,
    bounds: tuple,
    projected_bounds: tuple,
    projection: str,
    spacing: int,
) -> dict:
    south, west, north, east = bounds
    tiles = elevation_tiles(south, west, north, east)
    mosaic = directory / "mosaic.vrt"
    grid_file = directory / "terrain.bin"
    run_gdal("gdalbuildvrt", "-overwrite", mosaic, *tiles)

    left, bottom, right, top = projected_bounds
    x0 = floor(left / spacing) * spacing
    y0 = floor(bottom / spacing) * spacing
    x1 = ceil(right / spacing) * spacing
    y1 = ceil(top / spacing) * spacing
    run_gdal(
        "gdalwarp", "-overwrite", "-t_srs", projection, "-r", "bilinear",
        "-te", x0, y0, x1, y1, "-tr", spacing, spacing, "-ot", "Float32",
        "-dstnodata", "-9999", "-of", "ENVI", mosaic, grid_file,
    )
    width = (x1 - x0) // spacing
    height = (y1 - y0) // spacing
    samples = array("f")
    with grid_file.open("rb") as stream:
        samples.fromfile(stream, width * height)
    if any(not -100 < sample < 6000 for sample in samples):
        raise ValueError("DEM contains missing or out-of-range samples inside the requested terrain bounds")
    return {
        "east": x0 + spacing / 2,
        "north": y1 - spacing / 2,
        "spacing": spacing,
        "width": width,
        "height": height,
        "samples": samples,
    }


def sample_height(grid: dict, east: float, north: float) -> float:
    x = (east - grid["east"]) / grid["spacing"]
    y = (grid["north"] - north) / grid["spacing"]
    x0, y0 = floor(x), floor(y)
    if not 0 <= x0 < grid["width"] - 1 or not 0 <= y0 < grid["height"] - 1:
        raise ValueError(f"The DEM grid does not cover ({east}, {north})")
    index = y0 * grid["width"] + x0
    samples = grid["samples"]
    u, v = x - x0, y - y0
    first = samples[index] * (1 - u) + samples[index + 1] * u
    second = samples[index + grid["width"]] * (1 - u) + samples[index + grid["width"] + 1] * u
    return first * (1 - v) + second * v
