import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPortfolioServer } from '../scripts/server.mjs';

test('authenticated draft, preview and publish keep unpublished work private',async t=>{
  const root=await mkdtemp(join(tmpdir(),'portfolio-test-'));
  await mkdir(join(root,'site/media/uploads'),{recursive:true});await mkdir(join(root,'admin'),{recursive:true});
  await writeFile(join(root,'site/index.html'),'ok');
  const data={profile:{name:'Test'},projects:[{id:'one',slug:'one',title:'One',status:'published'}],education:[],experience:[],campus:[],skills:[],honors:[]};
  await writeFile(join(root,'site/content.json'),JSON.stringify(data));
  const app=await createPortfolioServer({root,password:'test-password-123',port:0,buildOnPublish:false});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.close(r));await rm(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(origin+'/api/content')).status,401);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({password:'test-password-123'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(path,method='GET',body)=>fetch(origin+path,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  data.projects.push({id:'draft',slug:'draft',title:'Secret draft',status:'draft'});
  assert.equal((await request('/api/content','PUT',{content:data})).status,200);
  assert.equal((await (await request('/api/preview-content')).json()).projects.length,2);
  assert.equal((await (await fetch(origin+'/content.json')).json()).projects.length,1);
  assert.equal((await request('/api/publish','POST')).status,200);
  assert.ok(!(await readFile(join(root,'site/content.json'),'utf8')).includes('Secret draft'));
  data.projects[1].status='published';await request('/api/content','PUT',{content:data});await request('/api/publish','POST');
  assert.equal((await (await fetch(origin+'/content.json')).json()).projects.length,2);
  const bad=await fetch(origin+'/api/content',{method:'PUT',headers:{Cookie:cookie,Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({content:data})});
  assert.equal(bad.status,403);
  assert.equal((await fetch(origin+'/.local/draft.json')).status,404);
});

test('static media supports byte ranges and rejects invalid ranges',async t=>{
  const root=await mkdtemp(join(tmpdir(),'portfolio-range-'));await mkdir(join(root,'site/media'),{recursive:true});await mkdir(join(root,'admin'),{recursive:true});
  await writeFile(join(root,'site/content.json'),JSON.stringify({profile:{name:'Test'},projects:[]}));await writeFile(join(root,'site/media/test.mp4'),'0123456789');
  const app=await createPortfolioServer({root,password:'test-password-123',buildOnPublish:false});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.close(r));await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.address().port}`;
  const r=await fetch(base+'/media/test.mp4',{headers:{Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(await r.text(),'2345');
  assert.equal((await fetch(base+'/media/test.mp4',{headers:{Range:'bytes=99-100'}})).status,416);
});
