// Reviewed pixel-art sprites (DRAWN, AI) woven into landing v3. Shipped byte-for-byte
// from the pinned pixel bank: no resampling (CSS scales them with pixelated rendering).
// Decorative only: alt="" and aria-hidden wherever they render; no visible provenance.
export const SPRITE_DIR = 'C:/Users/conta/co-3d/pixel-bank';
export const SPRITE_MAX_BYTES = 20000;
export const SPRITES = Object.freeze([
  { id: 'pixel-p1-idle', source: 'hero/hero-idle-front-AI-DRAWN.png', sha256: '736b424f30746b44f64ec50a9bb590ce8d36040c5679e94867ad5aab965c3f4d', width: 29, height: 47 },
  { id: 'pixel-p1-jump', source: 'hero/hero-cheer-jump-AI-DRAWN.png', sha256: '4c4663b03fb68651cec817e4b4bd376bd5f4def5642eebe2a1a8611bed8420dc', width: 31, height: 44 },
  { id: 'pixel-hero-selected', source: 'hero/hero-close-selected-AI-DRAWN.png', sha256: 'f86b650bc8de8bac622c4c7427fb63a99553ac388b9dc15e35a0661081cea43f', width: 49, height: 83 },
  { id: 'pixel-pickup-roll', source: 'items/pickup-roll-AI-DRAWN.png', sha256: '7bd8740176d4f90e08eb847fb91ec86200f0592be649dd6660d3decaf92eb028', width: 48, height: 33 },
  { id: 'pixel-pickup-chip', source: 'items/pickup-chip-AI-DRAWN.png', sha256: '0917c51faab2b05f0ca39b71f08560ff8afe02d137e6b4c8a4cad3bc1011678d', width: 37, height: 32 },
  { id: 'pixel-pickup-turkey', source: 'items/pickup-turkey-AI-DRAWN.png', sha256: 'ac08f896ada14244937defca2116b39684248e10cfa2eaaf02752e41d9ebe869', width: 38, height: 33 },
  { id: 'pixel-pickup-lettuce', source: 'items/pickup-lettuce-AI-DRAWN.png', sha256: 'fa93ea7c875efd3d1793ce917cedcde8a3ad1bd83db2cf35d6081df22fd12e55', width: 40, height: 32 },
  { id: 'pixel-pickup-pickle', source: 'items/pickup-pickle-AI-DRAWN.png', sha256: '3f022231cf471398338f19d2275e132846315dab66449bc432cfbae731e104dd', width: 29, height: 30 },
  { id: 'pixel-pickup-provolone', source: 'items/pickup-provolone-AI-DRAWN.png', sha256: 'b6d0639cabf22e0f04749489084f0eefd02c942b54879030275f5619bb16690b', width: 34, height: 32 },
  { id: 'pixel-hero-basket', source: 'hero/hero-close-walk-basket-AI-DRAWN.png', sha256: 'bb60e6cb20f2bd361420dc6bbc95ffe9785a91c3b621670eb15b91b89f843717', width: 59, height: 78 },
].map(Object.freeze));
