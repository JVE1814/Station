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

## Signalling, visual refinement and intercity source topology

- Added source-declared signal chainages, block reservations, physical overlap protection, dated same-direction traffic and a cab change at the Kristiansand reversal. Tested conflicting reservations, route reversals and continuous camera following.
- Reworked close materials and forest coverage from the first render against the references. Nine 1080p browser captures completed with zero console errors. A night lighting refresh and keyboard-driven arrival run remain in progress.
- The R40 pair bake reproduced byte-for-byte with `npm run data:pair`. Current R40 geometry audit sampled 1,302 rendered trackbed points with a 0.303 m maximum gap and 21,780 points in the sampled coach body envelope with zero terrain, tunnel, building or signal intersections.
- The browser performance run reported SwiftShader and timed out before it collected a moving-train timing sample. Hardware GPU performance remains unverified. The revised timing harness keeps the same p95 limits and sample count.
- Resolved source topology for F4, F5 and F6 with 48, 54 and 34 passenger station entries. Preserved the six mapped open F6 ways around a construction segment and the source track reversal at Kristiansand. Selected dated Entur departures have 21 F4 calls, 28 F5 calls and 20 F6 calls including departure.
- The first full scenery slicing attempt exceeded the executor memory limit. The current bake indexes the reduced OSM corridor once and shares geographic features across tile windows. A real three-tile R40 probe already passed rail seam and geographic checks.
