# Seimsgrend → Bulken evidence

Full-size PNGs are captured from the browser at 1920 × 1080. Comparison images place the GPT Image reference at left and the live renderer at right. The view study represents a fictional location. The simulator uses the mapped R40 corridor.

| Camera | Day | Night | Snow |
| --- | --- | --- | --- |
| Cab | [Compare](comparisons/cab-day.jpg) · [1080p](cab-day.png) | [Compare](comparisons/cab-night.jpg) · [1080p](cab-night.png) | [Compare](comparisons/cab-snow.jpg) · [1080p](cab-snow.png) |
| Chase | [Compare](comparisons/chase-day.jpg) · [1080p](chase-day.png) | [Compare](comparisons/chase-night.jpg) · [1080p](chase-night.png) | [Compare](comparisons/chase-snow.jpg) · [1080p](chase-snow.png) |
| Bird’s-eye | [Compare](comparisons/map-day.jpg) · [1080p](map-day.png) | [Compare](comparisons/map-night.jpg) · [1080p](map-night.png) | [Compare](comparisons/map-snow.jpg) · [1080p](map-snow.png) |

The [latest capture log](r40-final-captures.txt) records all nine views, zero console errors and zero external requests. The [first capture log](r40-captures.txt), [night lighting iteration](r40-night-refresh.txt) and [initial verification run](r40-initial-verify.txt) record earlier checkpoints.

[Intercity replay output](intercity-replays.txt) records the three route lengths, station and rail position errors, scheduled station calls, AI departures, stopping errors and velocity-derived jerk.

The [independent station audit](station-membership.txt) checks each displayed name and its coordinates against the pinned OSM extract. It traces nearby stations excluded from the simulation to their actual track. [Reproduction and source digests](station-membership.md)

The browser drive captured the [river bridge](bridge.png) in chase view and the [Bulken tunnel](tunnel.png) from the cab.

The [data rebuild output](data-rebuild.txt) records a full run of `npm run data` and the SHA-256 comparison of its public assets with the committed copies.

The [pre-optimization cab sample](r40-timing-before-batching.txt) records the initial 1080p CPU proxy failure and render workload that led to terrain, forest and cab batching.
