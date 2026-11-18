# Decisions

- Pin the Geofabrik Norway extract to the 2026-11-17 snapshot so updates to OSM cannot silently change the baked tracks or their verification targets.
- Use Copernicus DEM GLO-30 for terrain. It describes the top surface, so track elevations and the graded terrain corridor will need separate treatment around vegetation, structures, bridges and tunnels.
- Use OSM railway and passenger route relations to determine corridor and station membership. Preserve source IDs and tags through extraction so route choices and accuracy remain auditable.
