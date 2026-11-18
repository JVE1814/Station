# Progress

## Source and simulation groundwork

- Created the nine-view day, night and snow art direction study with GPT Image and saved it in `reference/`.
- Pinned the Norway OpenStreetMap snapshot and added source download, route inventory and OSM member extraction scripts. Confirmed the Copernicus DEM endpoint serves a readable WGS84 GeoTIFF.
- Added the TypeScript project configuration and a first fixed-timestep longitudinal dynamics module.
- Ran five focused tests covering input downloads, tile selection, the acceleration slew rate, interpolation and the door interlock.

The first station-pair checkpoint is in progress. It still needs a validated service relation and terrain bake, a browser renderer and driving controls, and checkpoint review evidence.

## Seimsgrend → Bulken

- Baked 2,736.9 m of R40 and the source track approaches, both OSM stations and platforms, 318 buildings, 11 forest features, seven water features, five signals and four adjacent track ways. The line includes the OSM-tagged bridge and Bulken tunnel.
- Added the browser controls, working cab instruments, original passenger stock, articulated bogie placement, three cameras, weather, scene lighting, horn, scoring and the 08:08 Entur timetable.
- Verified a clean dependency install, TypeScript, ESLint, production build and seven automated tests. The offline geographic audit matched both names and measured a maximum plan error under 1 mm for track and stations.
- The first-pair autopilot reached Bulken in 185.70 simulated seconds with a stopping error of 1.95 m and peak longitudinal jerk of 0.550 m/s³. Rendered trackbed sampled at 1,302 points showed 0.303 m maximum gap and zero missing intersections. A separate geometry audit sampled 6,465 coach-envelope rays around the bridge and tunnel and found zero intrusions.
- Chromium is using SwiftShader in this environment. An earlier browser build reached the terrain audit but timed out waiting for an interaction. The current build reduces forest and sky rendering cost. The 1080p comparisons, CPU frame timing and manual browser run are still in progress.
- Full F4, F5 and F6 operating coverage, streamed terrain and AI under block signalling remain pending.
