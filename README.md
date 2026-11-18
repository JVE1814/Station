# Station

Station is an offline desktop browser train simulator. It opens on the R40 from Evanger through Seimsgrend and Bulken to Voss. The 08:01 departure uses a dated Entur timetable. The stop-to-stop journey is 17.44 km, with a baked corridor of about 17.6 km including the terminal approaches. The service picker also offers the original short R40 and the Bergen, Stavanger and Trondheim intercity lines.

## Run

Use Node.js 22.18+ and a WebGL2 browser.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Use `npm run build` and `npm run preview` for the static production build. Once installed, the build serves all route, terrain, texture, timetable and sound data locally.

## Drive the R40

Press **L** for the interactive practice session. Follow its instructions to release the brake, power up, coast, stop and operate the doors. **R** returns you to Evanger and resets your score.

| Input | Action |
| --- | --- |
| W / S | Increase / reduce power one notch |
| E / Q | Apply / release the brake one notch |
| D | Open or close doors at the platform |
| H | Sound the horn |
| 1 / 2 / 3 | Cab / chase / Bird’s-eye |
| Drag / scroll | Look, orbit or pan / zoom |
| T | Cycle 1×, 2× and 5× simulation speed |
| P | Pause or resume |
| L / R | Practice / restart the service |
| A | Toggle automatic driving |

Release Brake 5 with Q before applying power. The lower-left guidance shows an approach speed and a suggested power or brake notch. The route panel previews the next signal and speed change. Stop beside the amber marker, open the doors, let passengers board, and close the doors before departing. Wet and snowy rail change traction and braking response. Result cards show stopping accuracy, timetable margin, passengers and score.

**Find station** in Bird’s-eye view jumps to a mapped platform. **Fit network** switches to the wider route map. **Sound** mutes the local simulation mix.

## Graphics

| Preset | Treatment |
| --- | --- |
| Low | Physical sky and 1024² shadow cascades, with direct rendering |
| High | 1536² cascades and an HDR pass for screen-space occlusion, haze and bloom |
| Ultra | 2048² cascades, stronger occlusion and multisampled HDR rendering |

The R40 starts at golden hour. Use the daylight control for blue hour and the weather control for clear, rain and snow. High and Ultra reflect the visible shoreline in the nearest lake. The gallery command always captures at Ultra. [R40 hero comparisons](reference/r40/README.md)

## Verify and rebuild

```sh
npm run verify
npm run capture:r40
```

Verification checks the pinned OSM geometry and Entur calls, real rendered clearance, fixed-step replays and browser behavior. The browser check measures p95 frame intervals on a hardware GPU at 1080p High. Without hardware graphics it reports calls and triangles. It expects Chromium at `/usr/bin/chromium`, with `CHROMIUM_PATH` as an override.

For baking, install Python 3.12+, osmium-tool, GDAL and `scripts/requirements.txt`. `npm run data:r40` refreshes the Evanger–Voss tiles. `npm run data` runs the complete offline data build. The browsers use the committed assets after a bake.

## Architecture and credits

The renderer follows a metric OSM rail spline and streams tiled scenery. The driver model advances in fixed steps with interpolated presentation. Mapped block signals, rail grade, applied effort, local weather and door state feed the driving and synthesis systems. The three views share the same service.

Route and feature data are from OpenStreetMap contributors. Timetables are from Entur. See [ASSETS.md](ASSETS.md) for elevation licenses, generated asset provenance and credits, [DECISIONS.md](DECISIONS.md) for implementation assumptions, and [PROGRESS.md](PROGRESS.md) for checkpoint results.
