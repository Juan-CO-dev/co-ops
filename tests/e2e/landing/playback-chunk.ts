import {readFileSync,readdirSync} from 'node:fs';
import {expect} from '@playwright/test';

/** Find the built lazy module by its unique DOM marker, not a shared media API. */
export function playbackChunkPaths(){
 const files=(readdirSync('.next/static/chunks',{recursive:true}) as string[])
  .filter(file=>file.endsWith('.js')&&readFileSync(`.next/static/chunks/${file}`,'utf8').includes('data-hero-motion-playback'));
 expect(files.length).toBeGreaterThan(0);
 return files.map(file=>`/_next/static/chunks/${file.replaceAll('\\','/')}`);
}
