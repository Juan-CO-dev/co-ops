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
});
