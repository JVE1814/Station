# Independent station membership audit

The input is the pinned Geofabrik source used by `scripts/source_data.py`. Run from the repository root with the project’s data-baking virtual environment. The corridor polygon is the union of bake tile bounds produced by `corridor_extract` in `scripts/bake_network_tiles.py`.

```sh
osmium tags-filter -R .cache/norway.osm.pbf \
  n/railway=station,halt n/public_transport=stop_position \
  r/public_transport=stop_area -o .cache/network-stops.osm.pbf

osmium extract --polygon .cache/network-full-work/corridor-17435bfdb747db0f.geojson \
  --strategy smart --option types=multipolygon \
  --output .cache/network-full-work/corridor-17435bfdb747db0f.osm.pbf \
  .cache/norway.osm.pbf

python scripts/audit_station_membership.py \
  --manifest public/data/network.json \
  --catalog .cache/network-stops.osm.pbf \
  --corridor .cache/network-full-work/corridor-17435bfdb747db0f.osm.pbf
```

The audit reads the actual committed/baked sourcePath input for each service. It examines national `railway=station|halt` nodes with a name and `railway:traffic_mode=passenger|mixed` not present in the station manifest. An omitted station within a 350 m plan-distance radius is resolved only if associated stop-position nodes are found on OSM operating rail ways and none shares a source way or node with the selected alignment. It exits with failure for an unresolved candidate. The results establish that the nearby omitted landmarks have calls on other alignments. The check covers the identified source tags and its search radius.

Source SHA-256 digests recorded at run time:

| Artifact | SHA-256 |
| --- | --- |
| `.cache/norway.osm.pbf` | `793c7ce48bc785a55179010293cb72ddb5d7a09d88d63375cc834859ff719bd5` |
| `.cache/network-stops.osm.pbf` | `290a97726cb83b49f8041de766c031b0c80210198da77625e01cf9c9e42ec123` |
| `.cache/network-full-work/corridor-17435bfdb747db0f.osm.pbf` | `47bf1ed1c9441227d0248ce306285433915efa85a8e8bc808af3ca97f6731d84` |
| `.cache/network-full-work/corridor-17435bfdb747db0f.geojson` | `fd4d7ecd7154dc146f085d844a7fa5e46cbc4c202bcfaea38199e8c33fb8e065` |
