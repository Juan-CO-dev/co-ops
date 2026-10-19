"""Landing v3 shop map: one self-hosted, brand-styled street raster of central DC.

  py scripts/assets/render-landing-map.py <out.png> <out-meta.json>   (called by export-map.mjs)

Source: OpenStreetMap data (ODbL 1.0; "(c) OpenStreetMap contributors" is shown under the
map), the pinned Overpass extract below (verified by SHA-256 before use). Geometry code is
the reviewed maps-ads renderer (rings/raster) reduced to roads, water and parks; no labels,
no network. The meta file carries only the public projection the page needs to place pins
and the visitor's own dot client-side: nothing location-dependent is ever requested.
"""
import hashlib, json, math, sys
import cv2
import numpy as np
from PIL import Image

OSM_JSON = 'C:/Users/conta/co-3d/best-sub/work/osm/dc.json'
OSM_SHA256 = '2844cdc840a7795b14f05e2ed4f69ec2e94fe6fc8719708ed85d559de426f162'
# Shop points = the OSM features at the shop addresses (maps-ads prep, extract base 2026-06-01).
SHOPS = {
    'dupont': (38.9097897, -77.0463016),
    'capitol-hill': (38.8817492, -76.9947597),
}
LAT0 = (SHOPS['dupont'][0] + SHOPS['capitol-hill'][0]) / 2
LON0 = (SHOPS['dupont'][1] + SHOPS['capitol-hill'][1]) / 2
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110950.0
HALF_M = 3300.0   # half-width of the square, metres
PX = 1600
COLORS = {'land': '#fbefcf', 'park': '#cde3a3', 'water': '#a7d6e6', 'casing': '#dcc58c', 'minor': '#ffffff', 'major': '#ffd83a'}
ROAD = {
    'motorway': (26, 0), 'trunk': (22, 0), 'primary': (18, 0), 'secondary': (15, 1), 'tertiary': (12, 1),
    'motorway_link': (12, 1), 'trunk_link': (12, 1), 'primary_link': (11, 1), 'secondary_link': (10, 2), 'tertiary_link': (9, 2),
    'residential': (9, 2), 'unclassified': (9, 2), 'living_street': (7, 2), 'pedestrian': (7, 2),
}

def xy(lat, lon):
    return (lon - LON0) * KX, (lat - LAT0) * KY

def rings(el):
    if el['type'] == 'way':
        g = el.get('geometry') or []
        return [[(p['lat'], p['lon']) for p in g]] if len(g) > 2 else []
    segs = [[(p['lat'], p['lon']) for p in m.get('geometry') or []] for m in el.get('members', []) if m.get('role') == 'outer' and m.get('type') == 'way']
    segs = [s for s in segs if len(s) > 1]
    out = []
    while segs:
        cur = segs.pop(0); changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur = cur + s[1:]
                elif s[-1] == cur[-1]: cur = cur + s[::-1][1:]
                elif s[-1] == cur[0]: cur = s + cur[1:]
                elif s[0] == cur[0]: cur = s[::-1] + cur[1:]
                else: continue
                segs.pop(i); changed = True; break
        if len(cur) > 2: out.append(cur)
    return out

def project(pts, scale):
    a = np.array([xy(la, lo) for la, lo in pts])
    return np.stack([(a[:, 0] + HALF_M) * scale, (HALF_M - a[:, 1]) * scale], 1)

def render(els):
    scale = PX / (2 * HALF_M); SH = 4; F = 1 << SH
    ipts = lambda p: np.round(p * F).astype(np.int32).reshape(-1, 1, 2)
    layer = lambda: np.zeros((PX, PX), np.uint8)
    water, park, casing, minor, major = layer(), layer(), layer(), layer(), layer()
    for e in els:
        t = e.get('tags', {})
        if t.get('natural') == 'water' or t.get('waterway') == 'riverbank':
            for r in rings(e): cv2.fillPoly(water, [ipts(project(r, scale))], 255, cv2.LINE_AA, SH)
        elif t.get('leisure') == 'park':
            for r in rings(e): cv2.fillPoly(park, [ipts(project(r, scale))], 255, cv2.LINE_AA, SH)
    roads = [(ROAD[e['tags']['highway']], e) for e in els if e['type'] == 'way' and e.get('tags', {}).get('highway') in ROAD]
    for (w, rank), e in roads:
        g = e.get('geometry') or []
        if len(g) < 2: continue
        p = ipts(project([(q['lat'], q['lon']) for q in g], scale)); th = max(2, int(round(w * scale * .9)))
        cv2.polylines(casing, [p], False, 255, th + max(2, int(round(th * .45))), cv2.LINE_AA, SH)
        cv2.polylines(major if rank == 0 else minor, [p], False, 255, th, cv2.LINE_AA, SH)
    rgb = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
    img = np.ones((PX, PX, 3), np.float32) * rgb(COLORS['land'])
    for mask, key in ((park, 'park'), (water, 'water'), (casing, 'casing'), (minor, 'minor'), (major, 'major')):
        a = (mask.astype(np.float32) / 255)[..., None]
        img = img * (1 - a) + rgb(COLORS[key]) * a
    return Image.fromarray(np.clip(np.round(img), 0, 255).astype(np.uint8)), scale

if __name__ == '__main__':
    raw = open(OSM_JSON, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != OSM_SHA256: sys.exit('OSM extract changed')
    data = json.loads(raw.decode('utf-8'))
    image, scale = render(data['elements'])
    image.save(sys.argv[1], optimize=False, compress_level=6)
    meta = {'lat0': LAT0, 'lon0': LON0, 'kx': KX, 'ky': KY, 'halfMetres': HALF_M, 'px': PX,
            'osmBase': data.get('osm3s', {}).get('timestamp_osm_base'), 'osmSha256': OSM_SHA256,
            'shops': {k: {'x': round((xy(*v)[0] + HALF_M) * scale / PX, 5), 'y': round((HALF_M - xy(*v)[1]) * scale / PX, 5)} for k, v in SHOPS.items()}}
    json.dump(meta, open(sys.argv[2], 'w'), indent=2)
    print(json.dumps(meta))
