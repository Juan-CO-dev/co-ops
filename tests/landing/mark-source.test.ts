import {it,expect} from 'vitest';
const modulePath='../../scripts/assets/mark-source.mjs';
const {deriveMarkSvg}=await import(/* @vite-ignore */ modulePath);
it('preserves separate compound subpaths and their cutouts while simplifying source coordinates',async()=>{
 const path='<path d="M0 0C10 0 20 0 30 0L30 30L0 30ZM10 10L10 20L20 20L20 10Z"/>';
 const source=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 805 894" width="805" height="894"><g fill="#141414">'+path.repeat(42)+'</g></svg>');
 const output=deriveMarkSvg(source,0.4);
 expect((output.toString().match(/<path/g)??[])).toHaveLength(42);
 expect((output.toString().match(/M/g)??[])).toHaveLength(84);
 const {default:sharp}=await import('sharp');
 const render=(input:Buffer)=>sharp(input).extract({left:0,top:0,width:30,height:30}).ensureAlpha().raw().toBuffer();
 expect(await render(output)).toEqual(await render(source));
 expect(deriveMarkSvg(source,0.4)).toEqual(output);
});
it('rejects changed source shape rather than partially interpreting it',()=>{
 expect(()=>deriveMarkSvg(Buffer.from('<svg/>'))).toThrow('Unexpected mark path count');
 expect(()=>deriveMarkSvg(Buffer.from('<path d="M0 0Q1 1 2 2Z"/>'))).toThrow('Unsupported mark source command');
});
