import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_SHA256 = '332643dcbff5eb90e1e862d20bc2b9aa9b09ca99f25376f7d92d11e5f5abad82';
export const CUT = { start: 17.3, duration: 0.9, poster: 17.5, crop: [0, 780, 1080, 1080], width: 720, height: 720 };
const source = 'C:/Users/conta/CO-Ads-Launch-2026-10/03 SUBDEX/SUBDEX_9x16_25s_TEXTLESS-AI-DRAWN.mp4';
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function assertVideo(info, bytes) {
  const video = info.streams.find(stream => stream.codec_type === 'video');
  if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width !== 720 || video.height !== 720 || info.streams.some(stream => stream.codec_type === 'audio') || Math.abs(Number(info.format.duration) - CUT.duration) > 1 / 30 || bytes > 1000000 || bytes < 1) throw new Error('SUBDEX export contract failed');
}

export function exportSubdex(root = process.cwd()) {
  if (hash(source) !== SOURCE_SHA256) throw new Error('Approved SUBDEX source hash changed');
  const work = resolve(root, 'tmp/subdex-export');
  mkdirSync(work, { recursive: true });
  const commands = [];
  const run = (tool, args) => {
    commands.push({ tool, args });
    const result = spawnSync(tool, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`${tool}: ${result.error ?? result.stderr.toString()}`);
    return result.stdout;
  };
  const ffmpeg = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const filter = 'crop=1080:1080:0:780,scale=720:720:flags=lanczos';
  const video = resolve(work, 'subdex-catch-drawn.mp4');
  const poster = resolve(work, 'subdex-catch-drawn.webp');
  const sourceProbe = probe(source);
  ffmpeg(['-ss', String(CUT.start), '-i', source, '-t', String(CUT.duration), '-an', '-vf', filter, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', video]);
  ffmpeg(['-ss', String(CUT.poster), '-i', source, '-vf', filter, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85', '-map_metadata', '-1', poster]);
  const videoProbe = probe(video);
  assertVideo(videoProbe, statSync(video).size);
  if (statSync(poster).size > 100000) throw new Error('SUBDEX poster exceeds budget');
  if (hash(source) !== SOURCE_SHA256) throw new Error('Original source changed during export');
  const entries = [['subdex-catch', video, 'mp4', 1000000], ['subdex-poster', poster, 'webp', 100000]].map(([id, file, extension, maxBytes]) => {
    const sha256 = hash(file);
    const publicPath = `/media/${id}-drawn-${sha256.slice(0, 12)}.${extension}`;
    const entry = { id, publicPath, classification: 'drawn', sourcePath: source, sourceSha256: SOURCE_SHA256, sha256, width: 720, height: 720, bytes: statSync(file).size, maxBytes, sidecar: `assets/provenance/${id}.json`, ...(extension === 'mp4' ? { duration: CUT.duration, codec: 'h264' } : {}), steps: ['Existing AI-DRAWN source; no generation', 'Crop and uniform resize; metadata stripped', extension === 'mp4' ? 'H264 CRF23 slow yuv420p faststart; audio removed' : 'WebP quality85'], cut: CUT };
    mkdirSync(resolve(root, 'public/media'), { recursive: true });
    mkdirSync(resolve(root, 'assets/provenance'), { recursive: true });
    copyFileSync(file, resolve(root, 'public' + publicPath));
    writeFileSync(resolve(root, entry.sidecar), JSON.stringify({ ...entry, alphaDependency: false, background: 'Opaque gold rays retained from source; framed card, no transparent edges', originalUnchanged: true, sourceProbe, ...(extension === 'mp4' ? { outputProbe: videoProbe } : {}), toolVersion: run('ffmpeg', ['-version']).toString().split('\n')[0], scriptSha256: hash(fileURLToPath(import.meta.url)), commands, review: 'All 27 frames inspected; no held item, baked text, or transition; Juan timecode approval pending' }, null, 2) + '\n');
    return entry;
  });
  writeFileSync(resolve(work, 'entries.json'), JSON.stringify(entries, null, 2) + '\n');
  return entries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(exportSubdex(), null, 2));
