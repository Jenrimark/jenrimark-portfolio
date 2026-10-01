import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicContent } from '../site/content-model.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function build(root = ROOT) {
  const site=join(root,'site'), out=join(root,'dist');
  if(resolve(out)!==join(resolve(root),'dist') || resolve(out)===resolve(root))throw new Error('Invalid output directory');
  const data=publicContent(JSON.parse(await readFile(join(site,'content.json'),'utf8')));
  await mkdir(out,{recursive:true});
  // Only recreate the explicitly named generated directory.
  for(const item of await readdir(out))await rm(join(out,item),{recursive:true,force:true});
  for(const name of ['index.html','styles.css','portfolio.css','gaze.mjs','gaze-math.mjs','portfolio.mjs','content-model.mjs'])await cp(join(site,name),join(out,name));
  await mkdir(join(out,'media/uploads'),{recursive:true});
  for(const name of ['hero-poster.png','hero-seek.mp4'])await cp(join(site,'media',name),join(out,'media',name));
  for(const project of data.projects)if(project.cover?.startsWith('media/uploads/'))await cp(join(site,project.cover),join(out,project.cover));
  await writeFile(join(out,'content.json'),JSON.stringify(data,null,2)+'\n');
  await writeFile(join(out,'.nojekyll'),'');
  await writeFile(join(out,'robots.txt'),'User-agent: *\nAllow: /\n');
  console.log(`Built ${data.projects.length} published projects into dist/`);
  return {path:out,projects:data.projects.length};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
