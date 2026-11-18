# Decisions

- Pin the Geofabrik Norway extract to the 2026-11-17 snapshot so updates to OSM cannot silently change the baked tracks or their verification targets.
- Use Copernicus DEM GLO-30 for terrain. It describes the top surface, so track elevations and the graded terrain corridor will need separate treatment around vegetation, structures, bridges and tunnels.
- Use OSM railway and passenger route relations to determine corridor and station membership. Preserve source IDs and tags through extraction so route choices and accuracy remain auditable.
- Start with R40 Seimsgrend → Bulken. The OSM passenger-service relation has a continuous alignment between the stops and provides tagged tunnel and bridge sections for the first review.
- Preserve a sourced approach beyond each stopping marker so the whole consist can follow rail at departure and arrival.
- Use the 08:08 R40 trip from Entur's 18 November 2026 data for the first playable service. The committed timetable extract keeps the selected trip reproducible when the public GTFS bundle rotates.
- Use the OSM maximum speed where it is tagged. The first autopilot uses a conservative 70 km/h fallback in untagged sections. The HUD shows a dash for the source speed in those sections.
- Constrain the DEM-derived first-pair rail profile to a 27‰ grade. The source tags supply plan alignment and structure extents, while the surface raster contains tree, cliff and deck artifacts. The grade bound removes abrupt source-surface artifacts without mirroring them in the railway.
