# Decisions

- Pin the Geofabrik Norway extract to the 2026-11-17 snapshot so updates to OSM cannot silently change the baked tracks or their verification targets.
- Use Copernicus DEM GLO-30 for terrain. It describes the top surface, so track elevations and the graded terrain corridor will need separate treatment around vegetation, structures, bridges and tunnels.
- Use OSM railway and passenger route relations to determine corridor and station membership. Preserve source IDs and tags through extraction so route choices and accuracy remain auditable.
- Start with R40 Seimsgrend → Bulken. The OSM passenger-service relation has a continuous alignment between the stops and provides tagged tunnel and bridge sections for the first review.
- Preserve a sourced approach beyond each stopping marker so the whole consist can follow rail at departure and arrival.
- Use the 08:08 R40 trip from Entur's 18 November 2026 data for the first playable service. The committed timetable extract keeps the selected trip reproducible when the public GTFS bundle rotates.
- Use the OSM maximum speed where it is tagged. The first autopilot uses a conservative 70 km/h fallback in untagged sections. The HUD shows a dash for the source speed in those sections.
- Warn the driver above the tagged limit with a 2 km/h tolerance. Sustained excess speed reduces the service score by up to 20 points. Drivers control how and when to brake.
- Constrain the DEM-derived first-pair rail profile to a 27‰ grade. The source tags supply plan alignment and structure extents, while the surface raster contains tree, cliff and deck artifacts. The grade bound removes abrupt source-surface artifacts without mirroring them in the railway.
- Use one local azimuthal equidistant coordinate system for the entire intercity network, so each service shares the same overview map. Bake disjoint rail intervals and overlapping DEM coverage into gzip scenery tiles. The browser loads upcoming tiles from local static files.
- Count passenger stations along the selected open physical alignment. Nearby platforms on separate routes enter the inventory only when mapped passenger-service membership connects them to the alignment. Keep all mapped stations separate from the calls on each dated service.
- Interpret OSM signal nodes on a railway way as chainage references. Place the pole beside the nearest track with clearance from adjacent tracks, while retaining the mapped signal node and direction in data.
- Use dated same-direction Entur journeys for moving traffic on the main route. Treat repeated use of an OSM way in the Kristiansand reversal as one physical block lock.
- Preserve mapped building footprints when an inferred roof overlaps the railway. Use an operational passage 7.2 m wide and 6.7 m high where needed, respect mapped minimum heights and leave canopy sides open.
- Mesh platform decks along the adjacent surveyed alignment. Adjust a mapped platform edge only where the raw footprint intrudes into the 1.85 m loading-gauge setback. Place generated signals, catenary supports and station furniture outside the nearest running alignments.
- Use a cubic plan spline bounded to 0.35 m from the source polyline between samples. Compute longitudinal grades from the fitted height profile over its distance along the track.
- Cache the corridor shadow view when looking forward from the cab or down from a high map position. Keep the faster stock-shadow updates for exterior views, close map views and nearby traffic.
- Enable the R40 driving profile at service creation. The power and brake handles have five active notches each, with separate traction and brake-pipe ramps. Rain and snow reduce available traction and braking. Intercity services use the existing profile.
- Keep the seven-metre platform tolerance as the door interlock on R40. Use deterministic simulated rider counts, a boarding dwell and a per-stop score for accuracy, time and comfort. The optional tutorial practices the same train controls at Evanger and restarts the passenger run on return.

## Evanger–Voss showpiece

- Use the OSM-selected Evanger → Seimsgrend → Bulken → Voss alignment and dated 08:01 R40 all-stops service. The new route is the landing service and the earlier Seimsgrend–Bulken pair remains selectable.
- Use the saved original renderer for the before frames. The before renderer has its existing daytime light. Its capture-only route loader and camera framing use the same mapped positions as the showpiece.
- Apply the golden-hour treatment, graphics presets and enhanced driving model to the R40 showpiece. Intercity lines retain their existing materials and physical limits.
- Use a solar altitude of roughly ten degrees as the late-September artistic lighting setup. Night uses blue-hour sky and lit rolling stock. All hero output is rendered from the running application at Ultra.
- Frame the chase above the sampled ground. Use the same grounded camera and the same Kartverket terrain grids for the saved before build and the new renderer.
- Advance R40 on a 32 ms timer that feeds the existing fixed-step integrator independently of rendering. Limit wall-clock catch-up to 350 ms per timer callback. Camera and particle motion retain their 100 ms cap.
- Report calls and triangles on software WebGL. The 16.7 ms timing threshold applies to hardware High at 1920 × 1080.
- Reframe the bridge, tunnel and lake overlook to show the piers, portal and train more clearly. Retake the corresponding before frames with the saved renderer and generate new paint-overs from those exact captures.
- For visual review, track the minimum individual category score across both reviewers and the fourteen renders. Use the same reviewers on subsequent image-only passes.
- Use the wider bridge composition after the closer view placed foreground trees across the train. Refine the river mesh near the mapped decks to reconcile terrain intersections and keep the OSM bank and island paths exact.
- Grow short grasses in a cached circle near the driver's viewpoint. Use the same mapped buildings, platforms, water, woods and track setbacks as the larger plants. Keep grass out of the Voss street survey area and off steep rock and tunnel mouths.
