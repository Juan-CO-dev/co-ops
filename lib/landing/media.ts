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
  spin: mediaPath('crunchy-boi-spin'), background: '#ed3308',
} as const;

export const subdexMedia = {
  poster: mediaPath('subdex-poster'), motion: mediaPath('subdex-catch'),
  width: 720, height: 720, background: '#FFE560',
} as const;
