# Asset sources

The data cache holds original downloads. Baked application data will retain attribution.

| Source | Use | License and attribution |
| --- | --- | --- |
| [OpenStreetMap extract from Geofabrik](https://download.geofabrik.de/europe/norway.html) | Railway and surrounding geographic features | © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright) |
| [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | Terrain surface elevations | Copernicus DEM public license. Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA. |
| [Kartverket DTM1](https://kartkatalog.geonorge.no/metadata/hoeyde-dtm1/0442c622-6639-4024-86be-846de8c15bb2) | Evanger–Voss bare-earth terrain, resampled from 1 m to 8 m streamed runtime grids | © Kartverket, [NLOD 2.0](https://data.norge.no/nlod/en/2.0). Source tile revisions and links are pinned in [data/r40-kartverket-source.json](data/r40-kartverket-source.json). |
| GPT Image | Original visual reference contact sheet | Generated for this project, see [reference](reference/) |
| [Entur Norway GTFS](https://developer.entur.org/pages-intro-datasets) | R40 timetable and trip references | Data from Entur under the Norwegian Licence for Open Government Data |
| GPT Image | Spruce cutout, grass, ballast, siding, roofing, dashboard and brushed-steel textures in `public/assets/` | Original generated material artwork |
| Station Web Audio synthesis in `src/audio.ts` | Traction, rolling gear, rail joints, brakes, doors, chimes, horn, tunnel reflections, weather and lakeshore ambience | Original procedural audio generated offline. Shoreline proximity uses the mapped OpenStreetMap water features above. |

## Evanger–Voss showpiece

- The spruce, pine and birch canopy, trackside plants, rock and soil strata, pitched-roof architecture and weatherable surfaces use the route's mapped geometry and original procedural art. `public/assets/norway-trees.webp` is an original GPT Image pine and birch cutout atlas.
- `public/assets/r40-ground.webp` is an original GPT Image albedo atlas of dry autumn grass, heather, spruce litter and fractured rock. The ground shader blends these surfaces by land cover and slope.
- The showpiece rolling stock uses the existing steel and dashboard maps with original procedural passenger-window and windscreen weather textures in `src/rolling-stock.ts`. The exterior and cabin remain unbranded.
- The physical daylight sky uses three.js Sky. The dusk sky, haze, ambient occlusion, grade and bloom are authored shaders in `src/showpiece-light.ts`.
- The `-golden-paintover.png` frames in `reference/r40/` are original GPT Image paint-overs of the corresponding before screenshots. The application renders the final frames independently from offline terrain, objects, materials and lighting.
