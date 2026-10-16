import inventory from '@/config/tenant/landing-assets.json';
function mediaPath(id: string): string {
  const asset = inventory.find(entry => entry.id === id);
  if (!asset) throw new Error('Missing approved media: ' + id);
  return asset.path;
}
/** Only public metadata enters the application. */
export const heroMedia = {
  poster: mediaPath('hero-poster'), width: 750, height: 1125,
  srcSet: [320, 640, 960].map(width => `${mediaPath(`hero-poster-${width}`)} ${width}w`).join(', '),
  // 2:3 object-contain within the 28rem height cap; mobile has 5rem total gutters.
  sizes: '(min-width: 640px) 18.666667rem, min(calc(100vw - 5rem), 18.666667rem)',
  spin: mediaPath('crunchy-boi-spin'), background: '#FFE560',
} as const;

export const subdexMedia = {
  poster: mediaPath('subdex-poster'), motion: mediaPath('subdex-catch'),
  width: 720, height: 720, background: '#FFE560',
} as const;
