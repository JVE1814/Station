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

## Updated R40 route playtest

I opened a fresh R40 session, used the six-step practice, then drove from Evanger to Voss with the game’s keyboard controls on Low at 960×600. The service took about 26 minutes wall time, including pauses and intermediate screenshots. The HUD showed 79 km/h in a 75 km/h section during this run. Intermittent HUD and input delays continued on this software-rendered host, and some captures took more than a minute.

| Result card | Score | Lateness | Stopping error | Passengers |
|---|---:|---:|---:|---|
| [Seimsgrend](updated-run/01-seimsgrend-result.png) | 83 / 100 | 89 s late | 1.1 m | 10 boarded · 7 alighted |
| [Bulken](updated-run/02-bulken-result.png) | 62 / 100 | 157 s late | 2.2 m | 4 boarded · 2 alighted |
| [Voss · Grade D](updated-run/03-voss-service-complete.png) | 67 / 100 | 195 s late | 2.8 m | 39 carried · 3 stops |

- Seimsgrend’s platform and shelter are recognizable in the normal cab view. The amber-edged marker is visible at 47 m but small among the poles and wipers. At the halt it is conspicuous, with part of the sign behind the right cab pillar. At Bulken, `STOP / Bulken` was readable from the cab at the halt. [Seimsgrend approach](updated-run/00-seimsgrend-marker-approach.png)
- Seimsgrend’s guidance at 47 m and 18 km/h read `Brake 1 · Aim for 16 km/h`. At Voss, 134 m out and travelling at 28 km/h, it still read `Power 5 · Aim for 37 km/h`. I coasted toward Voss and used the remaining distance to brake and align.
- `Within stop zone · D to open doors` was the reliable cue at all three stops. Voss accepted a halt that displayed 3 m this time, with a card error of 2.8 m. The earlier run also displayed 3 m before the cue, then required a short crawl. The rounded distance by itself leaves the cue necessary. This run did not pass a stop marker, so it adds no evidence about the past-marker display.
- At 960×600 the speed panel overlapped the Dismiss button on all three result cards. A pointer click at the center of the Seimsgrend Dismiss button left the card open during the next leg. Each card’s values were readable, and driving and boarding continued.
- After the full terminal dwell, Voss showed `Service complete · D to close doors`. D closed the doors and the cue changed to `Service complete · R to retry`, with 0 aboard.
