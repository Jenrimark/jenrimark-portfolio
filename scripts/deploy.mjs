import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build, ROOT } from './build.mjs';
export function command(args,root=ROOT) {return new Promise((res,rej)=>{const p=spawn('git',args,{cwd:root,windowsHide:true});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',rej);p.on('close',code=>code===0?res(out):rej(new Error(out.slice(0,1500))));});}
export async function deploy() {
  await build();
  const alreadyStaged=await command(['diff','--cached','--name-only']);
  if(alreadyStaged.trim())throw new Error('仓库已有暂存修改。请先处理这些修改，再通过后台同步内容。');
  const content=JSON.parse(await readFile(new URL('../site/content.json',import.meta.url),'utf8'));
  const publishedCovers=content.projects.filter(p=>p.status==='published'&&p.cover?.startsWith('media/uploads/')).map(p=>'site/'+p.cover);
  await command(['add','--','site/content.json']);
  if(publishedCovers.length)await command(['add','-f','--',...publishedCovers]);
  const diff=await command(['diff','--cached','--name-only']);
  if(diff.trim())await command(['commit','-m','content: publish portfolio updates']);
  await command(['push','origin','main']);
  return {message:'内容已推送，GitHub Pages 正在构建。',url:'https://jenrimark.github.io/jenrimark-portfolio/'};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await deploy());
