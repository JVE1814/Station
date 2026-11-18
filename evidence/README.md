# Seimsgrend → Bulken evidence

Full-size PNGs are captured from the browser at 1920 × 1080. The 3840 × 1080 comparisons place the GPT Image reference at left and the full-resolution live renderer at right. The view study represents a fictional location. The simulator uses the mapped R40 corridor.

| Camera | Day | Night | Snow |
| --- | --- | --- | --- |
| Cab | [Compare](comparisons/cab-day.jpg) · [1080p](cab-day.png) | [Compare](comparisons/cab-night.jpg) · [1080p](cab-night.png) | [Compare](comparisons/cab-snow.jpg) · [1080p](cab-snow.png) |
| Chase | [Compare](comparisons/chase-day.jpg) · [1080p](chase-day.png) | [Compare](comparisons/chase-night.jpg) · [1080p](chase-night.png) | [Compare](comparisons/chase-snow.jpg) · [1080p](chase-snow.png) |
| Bird’s-eye | [Compare](comparisons/map-day.jpg) · [1080p](map-day.png) | [Compare](comparisons/map-night.jpg) · [1080p](map-night.png) | [Compare](comparisons/map-snow.jpg) · [1080p](map-snow.png) |

The [snowy platform zoom](map-snow-platform.png) shows Seimsgrend from the close Bird’s-eye scale.

The [latest capture log](r40-final-captures.txt) records all nine views, zero console errors and zero external requests. The [first capture log](r40-captures.txt), [night lighting iteration](r40-night-refresh.txt) and [initial verification run](r40-initial-verify.txt) record earlier checkpoints.

[Intercity replay output](intercity-replays.txt) records the three route lengths, station and rail position errors, scheduled station calls, AI departures, stopping errors and velocity-derived jerk.

The [independent station audit](station-membership.txt) checks each displayed name and its coordinates against the pinned OSM extract. It traces nearby stations excluded from the simulation to their actual track. [Reproduction and source digests](station-membership.md)

The [manual Chromium run](manual-drive.txt) departed Seimsgrend, switched through all three cameras and scored 74/100 after stopping 2.1 m from Bulken’s marker. It captured the [river bridge](bridge.png), the [Bulken tunnel](tunnel.png), and the [arrival at Bulken](station.png) at 1080p.

The [data rebuild output](data-rebuild.txt) records a full run of `npm run data` and the SHA-256 comparison of its public assets with the committed copies.

The [network clearance output](network-clearance.txt) records the production mesh audit for all 169 intercity tiles and the R40 checkpoint.

The [offline network browser output](offline-network.txt) records WebGL2 startup for all three intercity routes and a Bird’s-eye jump from the F4 network view to the Stavanger platforms.

The [complete release verification transcript](verify.txt) contains the clean installation, 24 tests, production build, route replays, 1080p timing, geometry audit and offline browser checks.

The [pre-optimization cab sample](r40-timing-before-batching.txt) records the initial 1080p CPU proxy failure and render workload that led to terrain, forest and cab batching.
