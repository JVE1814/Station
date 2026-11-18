# R40 Evanger to Voss gallery

Each golden-hour strip shows the baseline frame, the GPT Image paint-over of that frame, and the final Ultra render from left to right. Strips are 5760 × 1080. Each baseline and final frame is 1920 × 1080. The paint-over is scaled to fit its panel.

The baseline uses the original renderer from `f90feff` with an adapter for the Evanger–Voss route and matching camera poses. Each original PNG was the input to its paired GPT Image edit. The game renders the final panels from the local route and scenery assets.

| Shot | Golden-hour comparison | Blue hour | Heavy snow |
| --- | --- | --- | --- |
| Lakeside chase | [Triptych](01-lakeside-chase-golden-comparison.png) | [Final](01-lakeside-chase-night-final.png) | [Final](01-lakeside-chase-snow-final.png) |
| Evanger cab | [Triptych](02-evanger-cab-golden-comparison.png) | | |
| Seimsgrend station | [Triptych](03-seimsgrend-golden-comparison.png) | | |
| River bridge | [Triptych](04-river-bridge-golden-comparison.png) | | |
| Tunnel mouth | [Triptych](05-tunnel-mouth-golden-comparison.png) | | |
| Bulken cab | [Triptych](06-bulken-cab-golden-comparison.png) | [Final](06-bulken-cab-night-final.png) | [Final](06-bulken-cab-snow-final.png) |
| Lake overlook | [Triptych](07-lake-overlook-golden-comparison.png) | [Final](07-lake-overlook-night-final.png) | [Final](07-lake-overlook-snow-final.png) |
| Voss overlook | [Triptych](08-voss-overlook-golden-comparison.png) | | |

## Full-resolution originals

| Shot | Baseline | Paint-over | Final Ultra render |
| --- | --- | --- | --- |
| Lakeside chase | [Before](01-lakeside-chase-golden-before.png) | [Reference](01-lakeside-chase-golden-paintover.png) | [Final](01-lakeside-chase-golden-final.png) |
| Evanger cab | [Before](02-evanger-cab-golden-before.png) | [Reference](02-evanger-cab-golden-paintover.png) | [Final](02-evanger-cab-golden-final.png) |
| Seimsgrend station | [Before](03-seimsgrend-golden-before.png) | [Reference](03-seimsgrend-golden-paintover.png) | [Final](03-seimsgrend-golden-final.png) |
| River bridge | [Before](04-river-bridge-golden-before.png) | [Reference](04-river-bridge-golden-paintover.png) | [Final](04-river-bridge-golden-final.png) |
| Tunnel mouth | [Before](05-tunnel-mouth-golden-before.png) | [Reference](05-tunnel-mouth-golden-paintover.png) | [Final](05-tunnel-mouth-golden-final.png) |
| Bulken cab | [Before](06-bulken-cab-golden-before.png) | [Reference](06-bulken-cab-golden-paintover.png) | [Final](06-bulken-cab-golden-final.png) |
| Lake overlook | [Before](07-lake-overlook-golden-before.png) | [Reference](07-lake-overlook-golden-paintover.png) | [Final](07-lake-overlook-golden-final.png) |
| Voss overlook | [Before](08-voss-overlook-golden-before.png) | [Reference](08-voss-overlook-golden-paintover.png) | [Final](08-voss-overlook-golden-final.png) |

## Assemble and verify

From the repository root, run the following after placing the captures and paint-overs in this directory. Python 3 with Pillow assembles the strips. The verifier checks image decoding, dimensions, and the exact baseline and final pixels in each strip.

```sh
node scripts/assemble-r40-gallery.mjs
node scripts/verify-r40-evidence.mjs
```

Use `--only=01` to select the first shot or `--dir=/path/to/gallery` to work in another directory.

## Independent visual review

[Reviewer A’s notes](review-a.md) · [Reviewer B’s notes](review-b.md)

[Keyboard playtest and stop cards](keyboard/README.md)
