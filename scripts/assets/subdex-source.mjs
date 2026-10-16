import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const SOURCE_SHA256 = '332643dcbff5eb90e1e862d20bc2b9aa9b09ca99f25376f7d92d11e5f5abad82';
export const SOURCE = 'C:/Users/conta/CO-Ads-Launch-2026-10/03 SUBDEX/SUBDEX_9x16_25s_TEXTLESS-AI-DRAWN.mp4';
export const CUT = { start: 17.3, duration: 0.9, poster: 17.5, crop: [0, 780, 1080, 1080], width: 720, height: 720 };
export const FRAME_ID = 'subdex-frame-17-5';
export const FRAME_PATH = 'assets/work/subdex-source-frame.png';
/** Local-only master: exact approved video's inspected frame, no AI generation. */
export function extractSubdexFrame() {
 if(createHash('sha256').update(readFileSync(SOURCE)).digest('hex') !== SOURCE_SHA256) throw Error('Approved SUBDEX source hash changed');
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(CUT.poster),'-i',SOURCE,'-vf','crop=1080:1080:0:780','-frames:v','1','-c:v','png','-map_metadata','-1','-f','image2pipe','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});
 if(result.error || result.status!==0 || !result.stdout.length) throw Error('SUBDEX frame extraction failed');
 return result.stdout;
}
