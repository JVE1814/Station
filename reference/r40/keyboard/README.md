# R40 keyboard playtest

I completed the six-step practice and drove the full R40 service from Evanger to Voss by keyboard. The successful retry took about 24 minutes wall time, including pauses and screenshot capture. The complete review took about 43 minutes, including the initial performance stalls and one missed stop.

| Result card | Score | Lateness | Stopping error | Passengers |
|---|---:|---:|---:|---|
| [Seimsgrend](01-seimsgrend-result.png) | 85 / 100 | 85 s late | 0.9 m | 10 boarded · 7 alighted |
| [Bulken](02-bulken-result.png) | 61 / 100 | 210 s late | 2.2 m | 4 boarded · 2 alighted |
| [Voss · Grade C](03-voss-service-complete.png) | 71 / 100 | 254 s late | 1.2 m | 39 carried · 3 stops |

Voss showed **Service complete** with 0 aboard. The final dwell cleared naturally, and D closed the doors afterward.

- The practice made brake, power, coasting, and door inputs clear. It allowed doors to open after an ordinary practice stop, so I first learned the alignment requirement during the service.
- At Seimsgrend I overshot by about 11 m on the first attempt. The HUD still said `0 m` while the doors rejected D and the game prompted a full retry. The Cab view gave me little visual guidance at the stop. [Missed-stop screenshot](seimsgrend-first-attempt-stop-missed.png)
- `At the marker · D to open doors` was the reliable cue. A rounded `0 km/h` appeared before that cue at Seimsgrend. At Voss, the first halt displayed `3 m` and required a short crawl before the cue appeared.
- I used Low graphics, 5× compression on open track, and 1× or 2× near platforms. I used browser automation to observe the visible HUD, press the actual pause key at chosen thresholds, and save screenshots. Intermittent HUD delays still made 5× harder to manage on this host.

## Updated build recheck

I opened a fresh game session at 1024×640 and completed the six-step practice again. The cards above record the earlier full route.

- The time control shows `T`, and three presses cycled `1×` → `2×` → `5×` → `1×`. Expanded Controls documents T along with power, braking, doors, and views. Its text appeared in the upper right, clear of the speed and power/brake panels at this viewport.
- From the initial Evanger departure, D opened the doors and the HUD showed `Boarding complete · D to close doors`. The passenger count stayed at 25 and Seimsgrend stayed next. A second D closed the doors and restored the driving prompt.
- Practice now labels the location `Practice at Evanger`. Step 5 says “Press D to open the doors. On the service, stop by the amber marker before opening.” This makes the service rule discoverable before departure. The exercise still lets the player open the doors after the practice halt, so it teaches the rule in text and leaves actual marker alignment to the service.
- This short recheck covered departure, the controls, and the lesson. The updated build’s in-route marker appearance and past-marker distance display remain unverified in this session.
