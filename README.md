# Station

Station is a desktop browser train simulator. The service picker offers the full F4 to Bergen, F5 to Stavanger, F6 to Trondheim and the shorter R40 Seimsgrend–Bulken service. R40 is the default service and starts at 08:08 on the 18 November 2026 timetable.

In Bird’s-eye view, **Fit network** shows all three intercity routes. Use the mouse wheel to zoom and drag to pan. **Follow train** returns the map to the running service.

## Run

Install Node.js 22.18 or newer and run the development server.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Use a WebGL2-capable browser. Run these commands to serve the production build.

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
| P | Pause or resume the game |
| A | Toggle automatic driving |

Start by releasing the brakes with Q, then apply power with W. Watch the speed limit and the distance to the next stop. Brake to a standstill at the stopping marker and open the doors to register the stop. The buttons in the top bar switch time of day and weather.

## Architecture

- The Python baker resolves connected rail ways and stop positions from OSM service relations, projects them to a local metric grid, and derives a vertical profile from Copernicus DEM.
- The browser keeps the active alignment and timetable in memory and streams nearby gzip scenery tiles. The tile bounds share one metric projection and the visible terrain has a single owner where tiles overlap. Three.js renders the infrastructure, scenery, original rolling stock and cab instruments.
- Longitudinal dynamics run at 120 Hz and interpolate the pose at render time. The train samples the alignment separately at each bogie. Cab, chase and bird’s-eye cameras share the same train state.
- The timetable is extracted from Entur GTFS. Same-direction scheduled trains share block occupancy with the player. F5 changes driving ends at Kristiansand. The baked world contains the original OSM identifiers and rail geometry used by the geographic checks.

## Rebuild data and verify

For a data bake, install Python 3.12+, osmium-tool, GDAL with `gdalbuildvrt` and `gdalwarp`, and the Python requirements in an active virtual environment. The first data bake downloads the pinned 1.38 GB OSM snapshot and the Copernicus DEM tiles it needs into `.cache/`. `npm run data:pair` regenerates the R40 checkpoint alone. The full bake uses the committed dated Entur extracts and installs gzip scenery tiles, a service catalog and the route manifest.

```sh
python -m pip install -r scripts/requirements.txt
npm run data
```

Run all automated checks with `npm run verify` or the station-pair checks with `npm run verify:pair`. The full run audits 169 scenery tiles and exercises accelerated service replays before browser verification. The verification runner reports each check separately. The browser check expects Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` for a different installation. `npm run verify:browser -- --captures` writes 1080p captures to `evidence/`.

The playable checkpoint and its side-by-side screenshots are indexed in [evidence](evidence/README.md). See [PROGRESS.md](PROGRESS.md) for review status and [ASSETS.md](ASSETS.md) for attribution.
