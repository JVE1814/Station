# Station

Station is a desktop browser train simulator. The current service is R40 between Seimsgrend and Bulken on the Bergen corridor. The 18 November 2026 timetable starts at 08:08 and calls at Bulken at 08:11.

## Run

Install Node.js 22.18 or newer and run:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Use a WebGL2-capable browser. To serve the production build:

```sh
npm run build
npm run preview
```

The static build serves its JavaScript, geometry and timetable locally. Gameplay needs no external network requests or service credentials.

## Drive

| Input | Action |
| --- | --- |
| W / S | Increase / reduce traction |
| E / Q | Apply / release the service brake |
| D | Open or close the doors while stopped |
| H | Sound the horn |
| 1 / 2 / 3 | Cab / chase / bird’s-eye |
| Drag / scroll | Look or pan / zoom |
| T | Cycle the time rate |
| A | Toggle automatic driving |

Start by releasing the brakes with Q, then apply power with W. Watch the speed limit and the distance to the next stop. Brake to a standstill at the stopping marker and open the doors to register the stop. The buttons in the top bar switch time of day and weather.

## Architecture

- The Python baker resolves connected rail ways and stop positions from OSM service relations, projects them to a local metric grid, and derives a vertical profile from Copernicus DEM.
- The browser loads the baked service, station, rail, terrain and feature data. Three.js renders rail infrastructure and scenery on a tessellated terrain grid. Rolling stock and cab instruments are built in code.
- Longitudinal dynamics run at 120 Hz and interpolate the pose at render time. The train samples the alignment separately at each bogie. Cab, chase and bird’s-eye cameras share the same train state.
- The timetable is extracted from Entur GTFS. The baked world contains the OSM identifiers and raw source geometry used by the geographic checks.

## Rebuild data and verify

For a data bake, install Python 3.12+, osmium-tool, GDAL with `gdalbuildvrt` and `gdalwarp`, and the Python requirements in an active virtual environment. The first data bake downloads the pinned 1.38 GB OSM snapshot and the Copernicus DEM tiles it needs into `.cache/`.

```sh
python -m pip install -r scripts/requirements.txt
npm run data
```

Run the current station-pair checks with `npm run verify:pair`. The browser check expects Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` for a different installation. `npm run verify:browser -- --captures` writes 1080p captures to `evidence/`.

See [PROGRESS.md](PROGRESS.md) for review status and [ASSETS.md](ASSETS.md) for attribution.
