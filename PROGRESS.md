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
- The final expanded audit passed all 169 intercity tiles. It recorded 811,299 trackbed probes with a 0.364 m maximum gap and zero missing, and 12,126,285 coach-envelope probes with zero intersections.

## 1080p rendering workload

- The first moving-train cab sample on SwiftShader recorded 11.82 ms on the renderer main-thread CPU clock. The last rendered frame issued 471 draws. Ended that superseded profiling run after the cab result so the next browser runs could exercise the optimized build.
- Batches now use physical terrain patch dimensions across DEM resolutions, combine distant spruce into larger tiles, and combine fixed cab parts without changing the gauge and lever animations. Static scenery matrices update only when each tile is built. At the same R40 cab diagnostic position, visible ground meshes fell from 133 to 26 and distant forest batches from 60 to 16.
- Typecheck, lint, 20 tests and the static build passed. Rechecked 1,302 R40 trackbed probes and 21,780 coach probes. The worst gap stayed 0.305 m and no coach probe intersected an obstacle. The full timed browser check still needs the new build.
- Captured the optimized production build at 1920 × 1080 for each view by day, night and snow. Chromium recorded zero console errors and zero external requests. The reference comparisons in `evidence/` use this capture set.

## Cab frame profiling

- The second SwiftShader CPU proxy run recorded 12.48 ms in the cab, 6.63 ms in chase and 14.01 ms in Bird’s-eye view. A separate phase trace found most of the cab work inside the WebGL render call.
- Instanced moving door components and merged rigid opaque stock casters for the depth pass. The tests check both door sides, texture and shadow flags, and retained geometry. Added a wider cached shadow view for the cab and high map, kept live stock shadows where the train is visible, and draw opaque cockpit depth before scenery.
- The fresh 1080p check will run on the latest build after the driving and earlier browser sessions close.
- Added distance-based scenery detail for high viewpoints. The detailed trees, fasteners, wires and insulators remain available close to the route and at platform zoom.

## Manual arrival

- Drove the R40 in Chromium with the in-game autopilot off and switched through cab, chase and bird’s-eye view. After braking at Bulken and opening the doors, the HUD reported 74/100, a 2.1 m stopping error and arrival 34 seconds late.
- Captured the bridge, tunnel and station at 1920 × 1080 in the same service. The run finished with zero browser console errors.

## Offline network browser

- F4, F5 and F6 loaded in Chromium with external requests blocked and zero console errors. The F4 run switched from the full network to the Stavanger platform scenery and retained the running Bergen service.
- The first full `npm run verify` finished with one failed stage, the 1080p CPU proxy. The latest build's isolated complete run is in progress.

## Chase frame budget

- The isolated run measured 4.69 ms in the cab and 5.41 ms in Bird’s-eye view. Chase measured 9.02 ms against the 8 ms CPU proxy limit.
- Moved the live shadow window to the center of the consist and drew opaque stock before scenery. Large trackside structures still cast shadows. The small rail fixtures remain rendered without their own depth pass.

## Release verification

- `npm run verify -- --captures` exited successfully. Clean install, TypeScript, lint, all 24 tests, the static build, three intercity replays, every scenery tile and all three offline intercity browser checks passed.
- At 1920 × 1080, the SwiftShader renderer-thread CPU proxy measured 6.32 ms in the cab, 5.54 ms in chase and 4.94 ms in Bird’s-eye view at p95. The transcript includes the longer software wall-frame intervals.
- Captured the nine final camera and weather combinations near the Bulken tunnel exit. Chromium reported zero console errors and zero external requests. All 12 required captures passed the 1080p dimension check.

## Evanger–Voss driving model

- Added controller and brake-pipe lag, separate rain and snow adhesion, forward signal and speed-change previews, live approach advice, boarding dwell and results for each call, a final grade and an interactive keyboard lesson.
- Passed five new driving tests and all seven existing dynamics, manual driving and service tests. The new cases include a full three-call fixture drive in dry, wet and snowy conditions with no emergency stops, under four metres of stopping error and the existing jerk threshold. TypeScript and lint passed for the driving changes.
- On the original mapped pair, the dry R40 profile matched the previous automatic replay at 190.50 seconds, 1.91 metres stopping error and 0.550 m/s³ peak jerk. Full-route replay and in-browser keyboard review await the Evanger–Voss bake and interface integration.

## R40 replay and keyboard checks

- Releasing the brake on a falling grade now holds acceleration at zero until the brake pipe releases. The new test checks jerk from measured speed, including the first movement. All 42 tests passed.
- Ran six full-route diagnostics on the mapped Evanger–Voss rail profile built with Copernicus for the pilot bake. Automatic driving and the displayed advisory notches served all three stops in clear, wet and snowy conditions. Every run reported zero emergency stops, peak jerk of 0.550 m/s³ and errors between 1.55 and 1.98 m. The clear advisory run finished in 1005.79 simulated seconds with grade B, 89/100 and 39 passengers carried.
- The six replays passed on the shipping Kartverket rail profile with 1.76–1.96 m stopping errors, zero emergency stops and 0.550 m/s³ peak jerk. The clear advisory run finished in 986.44 simulated seconds, grade A, 90/100 and 39 passengers carried.
- Added a production-build Chromium check that follows the driving guidance, exercises all six tutorial steps, visits all three views, saves the stop cards and retries the run. The initial SwiftShader run loaded the route and reached the second tutorial step using real key events. Ended the duplicate browser session so the independent keyboard review could use the host's full CPU allowance.
- F4, F5 and F6 passed the existing geography and full automatic replay checks, including their 0.550 m/s³ peak jerk threshold.

## Evanger–Voss source bake

- Baked 17.440 km from the pinned OSM R40 relation, including the four mapped stations, sourced track approaches, bridges, tunnels, speed limits, overhead power, signals and surrounding features. The five streamed terrain grids use Kartverket’s open 1 m DTM1, resampled to 8 m. The bake requests raster windows from the official Geonorge ranges and records the four source revisions.
- Matched all four calls on the selected Entur R40 journey for 18 November 2026, departing Evanger at 08:01 and arriving at Voss at 08:18. The dated timetable contains 36 district journeys in both directions.
- Verified a maximum OSM plan error of 0.0296 m on the rendered rail spline and under 0.0001 m at the four station markers. Every source call and tile seam passed. The clearance audit checked 6,699 trackbed samples, with a maximum gap of 0.316 m and zero missing, plus 131,535 coach probes with no intersections.
- The full data build now regenerates the separate Evanger–Voss data and catalog entry. The earlier Seimsgrend–Bulken checkpoint and the intercity assets keep their existing data paths.

## Evanger–Voss woodland rendering

- Added OSM-bounded woodland with spruce, Scots pine and birch, plus procedural willow, grass, fern and fireweed along suitable rail shoulders. The placement excludes mapped water, buildings, platforms and the running-track corridor. Added an original generated cutout atlas for pine and birch.
- TypeScript, targeted lint and three placement and LOD tests passed. An isolated Chromium scene rendered clear, snowy and elevated views with zero console errors. The integrated lakeside chase composition and its frame timing are under review.

## R40 civil works and platform activity

- Added rock and soil variation along exposed slopes, roofs built over the mapped building footprints, tunnel backfill with continuous terrain materials, and reflective water colors based on the mapped shoreline and elevation data. Platform surfaces and furnishings follow mapped material and amenity tags.
- Waiting passengers occupy the mapped deck. They walk to car door sills supplied by the stopped consist and stay on the platform if no open door is reachable.
- Checked all five Evanger–Voss tiles with polished scenery, using 6,699 trackbed samples and 131,535 coach-envelope probes. The maximum bed gap was 0.316 m, with no missing samples or envelope intersections. Five focused roof and boarding tests passed. Final camera captures and planar shoreline reflections are separate follow-up work.

## Lakeside chase vegetation pass

- On the 8.7 km Evanger–Voss tile, the previous global spacing thinned the active woods to 22 tree roots within 80 m of the track point. Denser sampling of the same OSM woods now places 223 roots within 80 m and 1,688 within 225 m. Warm autumn tints distinguish scattered birches from pine and spruce. Clustered low plants occupy dry, moderate-slope shoulders while preserving mapped exclusions.
- In the chase view, tree crowns now stay out of low-angle views through an eye-elevation test. The above-canopy representation remains available for steep overhead views. The targeted tests cover placement ownership, mapped exclusions, species tags, low-angle crown visibility and synchronized shadow motion.
- Indexed polygon edges by scan rows. The new placement generated the same full tile layout in 0.60 s during the local Node check, down from 6.47 s before indexing. TypeScript, targeted lint and all three vegetation tests passed.

## Lakeside chase and production integration

- Captured the before frame at 8,709 m and used that exact frame as the GPT Image input. The same grounded camera, train pose and terrain are used for the Ultra render. Refined reflections, shading, clearcoat, wooded banks and the rail-side planting against the target before moving on to the other shots.
- Integrated three graphics presets, physical daylight, blue hour, snow, cascaded shadows, post-processing, weatherable cab and train parts, the keyboard lesson and the simulation-driven sound mix. R40's fixed-step drive clock and HUD update independently of the camera render.
- TypeScript, lint, the 47 JavaScript tests and the Python data tests passed in development. Chromium captured the original and new 1920 × 1080 chase frames. The first triptych was assembled from the preserved source PNGs.
- The remaining Ultra frames, comparison assembly, full release verification, graphics workload report and independent reviews are in progress.

## First complete R40 gallery and blind review

- Captured eight golden-hour frames at 1920 × 1080 Ultra, plus blue-hour and heavy-snow versions of the lakeside chase, Bulken cab and lake overlook. Each paint-over came from its paired original frame. The gallery verifier decoded every file and matched the two render panels in all eight full-width strips pixel-for-pixel to the standalone screenshots.
- Two reviewers received only the fourteen renders. Their scores put the lowest visual category at 1/10. The leading issues were fan-shaped lake shading, sharp night beams, cab and passenger materials, and the visibility of the tunnel and train in overhead views. [Review A](reference/r40/review-a.md) · [Review B](reference/r40/review-b.md)
- The independent keyboard reviewer finished all six practice steps and started the manual service. The visual refinements and the full release verification remain in progress.

## Refinements from the first visual review

- Removed the lake’s triangulated color bands using a distance field from the mapped shores and island holes. Flowing water follows the source terrain cells. Added nearshore translucency and broke up reflections across the water surface.
- Replaced spaced bloom samples with two blur passes, softened and weathered headlight beams, improved blue-hour shadow detail, and moved precipitation with the camera. Added a reflective cab windscreen, fine desk grain and meter illumination. The dry ground now blends an original grass, heather, forest litter and rock atlas.
- Reframed the tunnel and lake views, captured their new before frames and generated matching paint-overs. The track and the mapped capture positions remain the same. Kept vegetation outside the mapped portals, opened the waiting shelter, corrected passenger silhouettes and cleared the terrain from the Voss platforms and sidings.
- Tests cover shore and island distance fields, river tessellation, camera framing, vehicle materials and passenger paths. The full five-tile R40 clearance audit still passes with a maximum 0.316 m gap and zero coach intersections. The remaining independent renders and scores are pending.
- After the keyboard reviewer’s first overshoot, the HUD now shows metres past the marker, differentiates rolling from stopped at low speed, moves the help panel clear of the gauges and labels the time-compression key.
- Enlarged the world stop marker and kept it beside the stopped train while passengers board. Reduced cab glass glare from its own lamp and softened the overexposed rail illumination at night.
- Hero captures now reuse one production scene. A focused test checks that every camera pose matches a fresh camera, and the browser capture asserts the rendered chainage for each frame.

## Second gallery review and full keyboard run

- Both independent reviewers scored all fourteen updated frames. The lowest category rose from 1/10 to 2/10. The lake’s fan-shaped shading is gone. The bridge’s angular bank and low train visibility in the night overlook remain the biggest gaps. [Review A](reference/r40/review-a.md) · [Review B](reference/r40/review-b.md)
- Rebuilt and checked all eight matched comparison strips and six weather versions, including the new exact before frames and paint-overs for the tunnel and lake overlook.
- The keyboard reviewer completed all six practice steps and manually drove all three stops. Their Voss card shows Grade C, 71/100, 1.2 m stopping error and 39 passengers carried. The HUD now surfaces door permission across the full platform tolerance and offers terminal door closure after dwell. A focused test exercises both cues.
- The first full verification passed the data checks, both sets of clearance audits, the R40 and intercity replays, the High graphics workload check and gallery checks. The intercity browser test timed out waiting for Bird’s-eye view. Camera transitions now advance on wall-clock time, and the offline browser check reports the current stage and any page errors on failure. Its rerun is in progress.

## Voss street and terminal cues

- Baked 253 mapped Voss road, access and path segments within 500 m of the station from the pinned OSM extract. The street mesh follows the rendered terrain and stays outside the railway gauge and platform polygons. Two independent bakes reproduced the shipped data, and 8,183 probe rays found no ground clipping in the rendered surface.
- The revised door cue recognizes the entire permitted platform zone at a standstill, and the terminal prompts to close doors when its dwell ends. Tests exercise the approach cue, terminal closure cue and retry status.
- The keyboard reviewer verified the updated time-compression shortcut, help placement, practice instructions and initial door operation. The three original stop cards and the reviewer’s account are preserved in the [keyboard evidence](reference/r40/keyboard/README.md).

## Clean capture scene and autumn balances

- Found duplicate scenery tiles during a reused gallery sequence. The loader now shares in-flight requests and returns existing tiles instead of attaching a second copy. Capture checks the attached tile IDs at each camera position. Discarded that sequence and started a fresh set for scoring.
- Lifted clear-day terrain in shade and softened highlights on the red paint. Added sparse summit snow to the distant material using source elevation and slope as well as the close terrain’s snow treatment.
- Reframed the river bridge from the opposite bank to bring its two piers into view. Shallow water follows the mapped edge with a softer blend, and reflections now strengthen at grazing angles. The gallery camera, shoreline field and reflection tests pass. The new capture and independent scores remain pending.

- Graduated trackside tree height from maintained suckers to mature woodland. In the same lakeside scene, the tallest rooted tree within 14 m of rail fell from 17.56 m to 2.78 m, and the tallest within 26 m fell from 18.95 m to 5.01 m. The mapped forest footprint and shrub exclusions still apply.
- Added autumn colour within the birch shader using leaf chroma before any instance tint. In the original cutout, the mask strongly selected 75% of the sampled opaque canopy pixels and selected zero of the 4,023 sampled bare-stem pixels. Pine and spruce bypass the autumn mask.

- Replaced tall, cool-green foreground plants with shorter tawny tussocks and dark russet scrub on steep, exposed rail banks. The open maintenance strip remains eligible where a broader OSM woodland polygon covers the embankment. Woodland boundaries, tree placements and clearance checks remain unchanged. At lakeside chainage 8.7 km, 130 of the plants within 80 m now use the dry-bank treatment. Vegetation count did not increase on that tile. Typecheck, targeted lint and all four vegetation tests passed.

## Seimsgrend waiting shelter

- Rebuilt the R40 waiting shelter on mapped footprint 512804977. Its opening faces the adjoining timber deck, with the tagged bench under a shallow dark roof. Corner posts stand on metal shoes, and rear and side screens provide cover. The model uses the same platform furniture collision checks as the other fixtures.
- On the Seimsgrend–Bulken tile, 1,707 trackbed probes found a maximum gap of 0.316 m with zero misses. All 26,820 coach-clearance probes passed. TypeScript, targeted lint, and five boarding and roof tests passed.

- Cleared foliage from the mapped tunnel mouths, including the Bulken approach in shot 05. The mask uses 12.8 m plus half the plant’s width and joins contiguous OSM tunnel ways before calculating portal positions. Streamed tiles use the neighboring rail window so a tile edge does not create or lose a clearing. The closest rooted plants at the two mapped Bulken mouths are now 13.30 m and 13.71 m away, with 52 and 35 roots still present in the nearby 15–25 m ring. Typecheck, targeted lint and all five vegetation tests passed.

## Waiting passengers at Seimsgrend and Bulken

- Closed the gap between jacket and trousers with an overlapping coat hem. Eight coat colors, alternating stances and sparse luggage distinguish waiting passengers. Walking keeps the existing path and footfall timing.
- A before-and-after check on the published Seimsgrend–Bulken tile found all thirteen waiting positions identical and the same boarding counts at both stops under the same sill placement. TypeScript, targeted lint, and all three boarding tests passed.

## R40 flowing water

- Matched the pale-blue strip in the Evanger cab review to OSM river relation 4094053. A single percentile height lifted the clipped river fragment more than 8 m above the local Kartverket surface. At the bridge, adjacent tiles could draw relation 4094046 with water levels 0.60 m apart. The straight near bank itself follows a 36.98 m source segment.
- Added reusable tessellation against the same world-aligned terrain cells and diagonals. It preserves the mapped outlines and holes and can use the terrain tile’s cell ownership. The mesh clears each coarse terrain triangle by 0.12 m.
- Three tests, typecheck and targeted lint passed. The real Evanger source mesh reduced maximum clearance above bilinear DTM from 8.704 m to 0.810 m. Across six overlapping river and tile combinations, the highest remaining difference from bilinear sampling was 1.635 m on a steep bank cell. The new mesh does not change the rail, stations or baked terrain.

- Replaced the rigid crossed understory in the round-two portal foreground with three staggered, arcing fronds per clump. The existing atlas, wind, weather and draw batches remain in use. Each visible clump adds six triangles and no draw calls. The fronds and the maximum rain sway stay within the existing placement radius. All five vegetation tests passed.

- Added short rush-like grass and willow clumps along the land side of mapped riverbanks and islands near the line. The existing vegetation masks, wind geometry, tile ownership and clearance rules apply. On the Evanger–Voss data, the new pass added 24 clumps within 85 m of the bridge viewpoint and at most 220 per tile. A direct comparison preserved every existing plant placement. Typecheck, targeted lint and all six vegetation tests passed.

- Added a close understory tier made from opaque tapered stems and individual leaves. The native-scale round-three lakeside and Seimsgrend crops showed full-card silhouettes in the foreground. The new tier shares every instance transform with the distant tier, and the two tiers draw exclusively. It uses existing wind and weather controls, retains woodland shadow casters, and fits the former clearance radius even in rain. The real tiles at the two viewpoints selected 558 and 704 detailed plants before frustum culling, bounding the increase to 16,740 and 21,120 triangles without increasing the active batch count. Typecheck, targeted lint and all six vegetation tests passed.

## Third visual review and browser regression check

- Captured the third set with consistently unique scenery tiles. Both reviewers assessed all fourteen images. The lowest score held at 2/10, for Seimsgrend foliage and the riverbank material. Reviewer B's lowest category was 3.6/10 and the lowest frame mean was the Voss overlook. [Review A](reference/r40/review-a.md) · [Review B](reference/r40/review-b.md)
- Verified the camera transition fix in the production offline browser check. F4, F5 and F6 loaded, and F4 reached the mapped Stavanger camera position with the correct service still selected.
- The next WebGL capture caught a GLSL reserved identifier in the distant-summit shader. Renamed it and restarted the complete verification and fourth gallery capture. The fourth score and the full verification result are pending.

## Fourth Ultra gallery and blind review

- Captured all fourteen 1920 × 1080 Ultra frames without duplicate scenery tiles or WebGL errors. Assembled and checked the eight matched comparison strips. The bridge strip uses the exact baseline and GPT Image edit for this round's lower viewpoint.
- The lowest category held at 2/10 for the second successive round. Both reviewers found the foreground trees and broad water fade hurt the bridge shot. They also flagged airborne snow over the Bulken cab trim, the blank tunnel cut and sparse detail on the high Voss view. [Review A](reference/r40/review-a.md) · [Review B](reference/r40/review-b.md)
- The full release check passed the R40 sources, rendered clearance, six weather replays and all three 1080p High graphics workload samples. Intercity service geography and replays passed. The all-tile intercity clearance and offline browser check are still running.
- The next render batch restores the wider bridge angle and corrects the mapped river-edge intersection. It also includes cab and tunnel material revisions, warmer station lamps, shorter foreground grasses and a new same-chainage Voss composition.

## Independent keyboard retest

- The reviewer completed the six-step practice and served all three stops manually in a fresh Low session at 960×600. The terminal card records Grade D, 67/100, 2.8 m from the marker, 39 passengers carried and zero remaining aboard. The reviewer also closed the doors after dwell. All four new screenshots decoded at their recorded viewport size.
- The reviewer confirmed the stop-zone door cue at every platform and reproduced a small-window Dismiss collision and an unnecessary traction cue near Voss. The next build moves the cards above the driving gauges and favors coasting when already rolling toward a near stop. Its direct layout check and all six replays passed. The reviewer is driving that build next. [Playtest notes and cards](reference/r40/keyboard/README.md)

## Voss overlook candidate

- Preserved the Voss shot’s 17,525.21 m chainage. The camera now looks southeast from the town side of the railway at 75 m above the focus ground, using a 1.36 horizontal lean and a −2.24 rad bearing from the original south-facing axis. The focus is 14 m east and 10 m south of the train, with 3 m of target lift.
- In a diagnostic projection of the actual OSM footprints and the baked terrain, visible roof area for the two foreground hotels dropped from about 11% of the frame to about 2%. All three carriage centres stayed inside the frame. The diagnostic geometry is a composition check, with rendered comparison still pending.
- Broad untagged flat roofs use a muted material tint based on footprint area. Recognised OSM roof material and explicit colour take priority. Roof geometry is unchanged. TypeScript, focused lint and all eight camera/roof tests passed in the isolated worktree.

## Cab, tunnel, river and station refinements

- Built recessed controls, instrument vents, indicator lenses and distinct brake and power grips. Tests check physical recess depth, lever travel and the preserved driver sightline. Softened the headlight footprint and added downward pools of warm light under the R40 station fixtures. The cab and exterior use the same beam direction and weather response.
- Added granular scree, layered bedrock and coursed stone at the mapped tunnel approaches. Two tests cover the local material mask and the real tunnel tile's material bindings. The tunnel clearance audit found a maximum 0.316 m trackbed gap and no intersections in 26,820 coach probes.
- Traced the jagged river edge in the wide bridge view to rendered terrain protruding through the water 4.1–12.9 m inside the OSM bank. Subdivided the river mesh locally against the same terrain grid, retaining the source outline, island holes and deck clearance. Samples across all 35 diagnostic image rows no longer hit the protruding terrain first. Restored the wider camera and narrowed the shoreline fade. Five river tests and the bridge tile's trackbed and coach clearance passed.
- Turned the Seimsgrend shelter entrance onto the 2.21 m edge it shares with the mapped platform. Its floor meets the timber deck within the original footprint. Tests check the entrance, floor and passenger placement. Added close grass blades to cleared land outside the railway and mapped fixtures. A browser shader probe rendered the actual Seimsgrend layers with 12,115 grass clumps and no WebGL errors.
- Made the amber stop board higher contrast and slightly larger on approach after the keyboard retest found the original label hard to read. Its world anchor and door-interlock position remain fixed. A test checks sign color, position, approach scaling and visibility.
- Put result cards and practice above the driving HUD in a shared layout. The keyboard retest found the speed panel covering Dismiss at 960×600. Dismiss now shows its Escape shortcut, and the browser verifier checks the button remains clickable at 960×600 and 720×600.
- Faded airborne precipitation before it reaches the cab interior and inset frost from the windscreen trim. The focused test covers cab and exterior particle clearance as well as tunnel shelter.
- The keyboard retest found the Voss advisory suggesting full power 134 m from the platform. The new approach logic coasts a rolling train through this interval and retains braking and low-speed traction cues. A focused test reproduces the reported speed and distance, and all six dry, wet and snowy R40 replays pass.
- The previous full verifier passed all geometry, replays and frame workloads. On the shared software host, its F4 readiness deadline expired as the page reached the running Cab state with no console errors. The offline smoke test now checks explicit running or failed readiness, allows time for startup and camera navigation, and exercises the same service and offline assertions.

## Final visual review

- Captured all fourteen fifth-round Ultra frames at 1920 × 1080. Built the eight comparison strips with the original wide bridge pair and the new Voss baseline and GPT Image edit. Decoded all six alternate-weather renders and independently matched all twenty-four strip panels to their source pixels at the gallery resolution.
- Both reviewers scored all five categories for each image. Reviewer A's lowest score was 2/10, for materials in the bridge, tunnel and Voss views. Reviewer B's lowest score was 2.9/10 for the tunnel cut. The weak areas include a sharp boundary and planar wedges in the bridge water, the grid across the tunnel cut and angular land patches in the water at Voss. The lowest score held through three successive rounds, completing visual iteration under the agreed stop rule. [Review A](reference/r40/review-a.md#round-5) · [Review B](reference/r40/review-b.md#round-5)
- The integrated R40 passed its build, source and clearance checks, all six replays, and the 1080p High graphics workload check in each view. The intercity review and latest keyboard run remain in progress.

## Final keyboard drive

- The reviewer repeated practice and drove the release build with the keyboard at 960×600. They served Seimsgrend and Bulken, verified the doors reject moving and short-position attempts, and dismissed both cards with Escape. All three screenshots from this pass decoded at 960×600.
- A HUD stall at 5× and a brake-input error led to a missed Voss stop on this pass. The HUD showed the distance past the marker and retry cue. The reviewer used R and verified the service returned to its Evanger departure with a cleared result. The two completed manual drives and this final run are recorded together. [Keyboard notes and cards](reference/r40/keyboard/README.md)
