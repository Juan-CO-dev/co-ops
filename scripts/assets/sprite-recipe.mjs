// Reviewed pixel-art sprites (DRAWN, AI) woven into landing v3. Shipped byte-for-byte
// from the pinned pixel bank: no resampling (CSS scales them with pixelated rendering).
// Decorative only: alt="" and aria-hidden wherever they render; no visible provenance.
export const SPRITE_DIR = 'C:/Users/conta/co-3d/pixel-bank';
export const SPRITE_MAX_BYTES = 20000;
export const SPRITES = Object.freeze([
  { id: 'pixel-p1-idle', source: 'hero/hero-idle-front-AI-DRAWN.png', sha256: '736b424f30746b44f64ec50a9bb590ce8d36040c5679e94867ad5aab965c3f4d' },
  { id: 'pixel-p1-jump', source: 'hero/hero-cheer-jump-AI-DRAWN.png', sha256: '4c4663b03fb68651cec817e4b4bd376bd5f4def5642eebe2a1a8611bed8420dc' },
  { id: 'pixel-hero-selected', source: 'hero/hero-close-selected-AI-DRAWN.png', sha256: 'f86b650bc8de8bac622c4c7427fb63a99553ac388b9dc15e35a0661081cea43f' },
].map(Object.freeze));
