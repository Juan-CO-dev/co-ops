import inventory from '@/config/tenant/landing-assets.json';
function mediaPath(id: string): string {
  const asset = inventory.find(entry => entry.id === id);
  if (!asset) throw new Error('Missing approved media: ' + id);
  return asset.path;
}
/** Only public metadata enters the application. */
export const heroMedia = {
  poster: mediaPath('v2-p013-960'), width: 960, height: 1440,
  srcSet: [320, 480, 640, 960, 1280].map(width => `${mediaPath(`v2-p013-${width}`)} ${width}w`).join(', '),
  // Full-bleed mobile image; exactly half the viewport on desktop.
  sizes: '(min-width: 768px) 50vw, 100vw',
} as const;

/** Shared real-photo candidates: identical sizes/URLs enable reuse in all three sections. */
function texturePhoto(source:'p016'|'l083'|'l118') {
  return {src:mediaPath(`v2-${source}-720`),width:720,height:1080,
    srcSet:[480,720,960].map(width=>`${mediaPath(`v2-${source}-${width}`)} ${width}w`).join(', '),
    sizes:'(min-width: 768px) 480px, calc(100vw - 44px)'};
}
export const textureMedia={
  texture:texturePhoto('p016'),crossSection:texturePhoto('l083'),
  // Real spread: hands reaching into the table (Lifestyle_Kitchen sm_118).
  catering:texturePhoto('l118'),
  // Inset: wrapped Crunchy Boi halves stacked in a catering box (sm_082); shown small.
  cateringBox:{src:mediaPath('v2-l082-480'),width:480,height:721,srcSet:`${mediaPath('v2-l082-480')} 480w`,sizes:'200px'},
};

/** Drawn turntable frames (one revolution, 7.5 degrees apart); decorative, never a real photo. */
export const spinMedia = {
  frames: Array.from({length:48},(_,index)=>mediaPath(`crunchy-boi-spin-f${String(index).padStart(2,'0')}`)),
  width: 540, height: 284,
} as const;

function sprite(id:string) {
  const asset = inventory.find(entry => entry.id === id) as {path:string;width?:number;height?:number}|undefined;
  if (!asset?.width || !asset.height) throw new Error('Missing approved sprite: ' + id);
  return {src:asset.path,width:asset.width,height:asset.height};
}
/** Pixel sprites render with image-rendering: pixelated, alt="" and aria-hidden. */
export const spriteMedia = {
  basket: sprite('pixel-hero-basket'),
  p1Idle: sprite('pixel-p1-idle'), p1Jump: sprite('pixel-p1-jump'), selected: sprite('pixel-hero-selected'),
  pickups: {bread:sprite('pixel-pickup-roll'),chips:sprite('pixel-pickup-chip'),turkey:sprite('pixel-pickup-turkey'),iceberg:sprite('pixel-pickup-lettuce'),pickles:sprite('pixel-pickup-pickle'),provolone:sprite('pixel-pickup-provolone')},
} as const;
