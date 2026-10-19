// Reviewed recipe for the landing shop map (OSM-derived street raster, self-hosted).
export const MAP_RECIPE = Object.freeze({
  id: 'landing-map',
  sourceId: 'osm-dc-extract',
  osmPath: 'C:/Users/conta/co-3d/best-sub/work/osm/dc.json',
  osmSha256: '2844cdc840a7795b14f05e2ed4f69ec2e94fe6fc8719708ed85d559de426f162',
  renderer: 'scripts/assets/render-landing-map.py',
  renderPx: 1600,
  width: 1200,
  height: 1200,
  quality: 72,
  effort: 6,
  maxBytes: 160000,
  // Reviewed projection contract: pins and the visitor dot use exactly these numbers.
  projection: Object.freeze({lat0: 38.89576945, lon0: -77.02053065000001, kx: 86639.18862384661, ky: 110950, halfMetres: 3300}),
});

const PROJECTION_KEYS = ['lat0', 'lon0', 'kx', 'ky', 'halfMetres'];
/** The runtime map config must name the shipped image and carry the reviewed projection. */
export function validateMapConfig(config, entry) {
  if (config.image !== entry.publicPath || config.width !== entry.width || config.height !== entry.height) throw Error('Map config mismatch');
  for (const key of PROJECTION_KEYS) if (config[key] !== MAP_RECIPE.projection[key]) throw Error(`Map projection mismatch: ${key}`);
}
/** Renderer output must reproduce the reviewed projection exactly. */
export function validateRenderedProjection(projection) {
  for (const key of PROJECTION_KEYS) if (projection[key] !== MAP_RECIPE.projection[key]) throw Error(`Rendered projection mismatch: ${key}`);
}
