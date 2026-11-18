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

## Baked intercity network

- Installed 169 byte-stable gzip scenery tiles and the real-axis network overview for F4, F5 and F6. The data bundle includes the original source ways and 136 source-matched station entries across the three alignments.
- Added the offline service picker and a full network fit in Bird’s-eye view. Nearby track, terrain and mapped features stream around the train or the close map focus.
- The first five F4 meshes passed after a source-footprint clearance fix. Across 9,669 trackbed observations, the maximum gap was 0.282 m with no missing intersections. There were zero intersections in 333,675 coach-envelope observations. The larger geometry audit is running.
- The nine R40 1080p comparisons and a brighter night refresh are committed under `evidence/`. The Chromium keyboard run departed Seimsgrend and switched to all three cameras. Its arrival is pending.

## Full service replays

- F4, F5 and F6 completed their dated schedules with 20, 27 and 19 calls after departure. The runs dispatched 3, 4 and 3 same-direction AI services and required zero emergency block or end-of-track stops.
- Maximum rail deviation was 0.125 m across the three alignments. The 136 station markers matched their source names and positions, and the global rail joined exactly at each of the 169 tile interfaces.
- The updated brake envelope limits measured longitudinal jerk during the final approach to rest. Velocity-derived peak jerk was 0.550 m/s³ on each replay. The worst stopping error was 1.96 m.
- Fixed bridge approach grades and DSM terrain protrusions beneath a mapped bridge. Targeted rechecks passed for the affected F4 tiles and for R40. The full mesh audit continues.

## Passenger station source audit

- Added the OSM relation call inventories to the baked source bundles and verified their exact stop IDs against the 136 station entries. The three full timetable replays passed again after adding the comparison.
- Independently read the 136 names and coordinates from the pinned OSM extract. Inspected all omitted passenger or mixed-use landmarks within 350 m and traced seven to separate tracks. The commands, source digests and output are in `evidence/`.

## Driving feedback and tunnel cameras

- Added a line-speed warning and scoring penalty for sustained overspeed. A focused test drives two identical approaches under different limits and confirms the penalty changes the score.
- Lowered the default chase camera and constrained its orbit inside mapped tunnel bores. Camera tests exercise the tunnel envelope, follow motion and view transitions.
- Added headlight scattering in the beam and frame draw counts in timing output. TypeScript, lint, the focused tests and the production build passed. Frame timings and the complete accelerated browser drive are still running.

## Network-to-platform camera

- Added a station selector to the intercity bird’s-eye view. It anchors the camera at the mapped station, loads scenery from the selected corridor and leaves the train’s service unchanged. The camera anchor test and all 19 unit tests passed with typecheck, lint and the production build.
- The offline browser smoke test now verifies a jump from the whole-network view to Stavanger platforms during an F4 service. The queued browser run will exercise the production build.
- The software rendering benchmark now reads Chromium’s main-thread CPU clock and separately reports wall time. Confirmed Chromium exposes thread timestamps on User Timing marks. The 8 ms proxy limit and the 16.7 ms hardware frame interval limit are unchanged.

## Data regeneration and station approach

- Ran `npm run data` with the documented data toolchain. Every published data file regenerated byte-for-byte, including the R40 checkpoint, 169 intercity tiles, three source bundles, route manifest and timetables.
- Captured the R40 bridge and tunnel during a browser run. That run passed Bulken’s stopping marker. Revised the manual input sequence to begin braking earlier and tested the full control sequence using five HUD polling intervals. The new browser drive is in progress.

## Structure clearance

- The first 169-tile audit exposed five issues. Fixed the underlying bridge terrain and abutments, a tunnel approach, a signal pole lacking a source heading and the lining on a sharp tunnel curve. All five targeted reruns passed.
- Expanded the production coach audit to include actual platform, bridge and catenary geometry. Graded platform meshes against the rail profile, kept curbs outside the loading gauge and moved generated supports and station furniture away from neighboring tracks around the Kristiansand reversal.
- Expanded regressions passed at Seimsgrend and Bulken, Oslo S, Lysaker, Drammen, Kristiansand, Stavanger and Trondheim. The fresh all-tile audit is queued.

## 1080p rendering workload

- The first moving-train cab sample on SwiftShader recorded 11.82 ms on the renderer main-thread CPU clock. The last rendered frame issued 471 draws. Ended that superseded profiling run after the cab result so the next browser runs could exercise the optimized build.
- Batches now use physical terrain patch dimensions across DEM resolutions, combine distant spruce into larger tiles, and combine fixed cab parts without changing the gauge and lever animations. Static scenery matrices update only when each tile is built. At the same R40 cab diagnostic position, visible ground meshes fell from 133 to 26 and distant forest batches from 60 to 16.
- Typecheck, lint, 20 tests and the static build passed. Rechecked 1,302 R40 trackbed probes and 21,780 coach probes. The worst gap stayed 0.305 m and no coach probe intersected an obstacle. The full timed browser check still needs the new build.
