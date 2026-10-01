import http from 'node:http';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { validateContent, publicContent } from '../site/content-model.mjs';
import { build, ROOT } from './build.mjs';
import { deploy } from './deploy.mjs';

const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.ico':'image/x-icon','.txt':'text/plain'};
async function atomic(path,value){const temp=path+'.tmp';await writeFile(temp,value);await rename(temp,path);}
async function jsonBody(req,limit=2_000_000){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>limit)throw Object.assign(new Error('请求内容过大'),{status:413});parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{throw Object.assign(new Error('无效的 JSON'),{status:400});}}
export async function createPortfolioServer({root=ROOT,password,port=8766,buildOnPublish=true}={}){
  const local=join(root,'.local'),site=join(root,'site'),admin=join(root,'admin'),draftPath=join(local,'draft.json');
  await mkdir(local,{recursive:true});await mkdir(join(site,'media/uploads'),{recursive:true});
  let auth;
  try{auth=JSON.parse(await readFile(join(local,'auth.json'),'utf8'));}catch{const initial=password||process.env.ADMIN_PASSWORD||randomBytes(18).toString('base64url');const salt=randomBytes(16).toString('hex');auth={salt,hash:scryptSync(initial,salt,32).toString('hex')};await atomic(join(local,'auth.json'),JSON.stringify(auth));if(!password)await writeFile(join(local,'admin-access.txt'),`本地管理后台：http://127.0.0.1:${port}/admin/\n密码：${initial}\n此文件仅保存在本机，不发布。\n`);}
  try{await stat(draftPath);}catch{await atomic(draftPath,await readFile(join(site,'content.json'),'utf8'));}
  const sessions=new Map();let failures=0,lockedUntil=0,publishing=false,deploying=false;
  const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
    try{
      const address=server.address();const allowed=new Set([`127.0.0.1:${address?.port}`,`localhost:${address?.port}`]);
      if(!allowed.has(req.headers.host)){reply(res,403,{error:'仅允许本地访问'});return;}
      const url=new URL(req.url,`http://${req.headers.host}`),path=decodeURIComponent(url.pathname);
      const stateChanging=!['GET','HEAD'].includes(req.method);
      if(path.startsWith('/api/') && stateChanging && req.headers.origin!==url.origin){reply(res,403,{error:'请求来源不受信任'});return;}
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('portfolio_session='))?.slice(18);
      const session=sessions.get(token);const signedIn=!!session&&session>Date.now();
      if(path==='/api/login'&&req.method==='POST'){
        if(Date.now()<lockedUntil){reply(res,429,{error:'尝试次数过多，请稍后重试'});return;}
        const body=await jsonBody(req,4000);const value=String(body.password||'');const hash=scryptSync(value.slice(0,256),auth.salt,32);
        if(!timingSafeEqual(hash,Buffer.from(auth.hash,'hex'))){if(++failures>=5){lockedUntil=Date.now()+60_000;failures=0;}reply(res,401,{error:'密码不正确'});return;}
        failures=0;const id=randomBytes(32).toString('hex');sessions.set(id,Date.now()+8*60*60*1000);res.setHeader('Set-Cookie',`portfolio_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);reply(res,200,{ok:true});return;
      }
      if(path.startsWith('/api/')){
        if(!signedIn){reply(res,401,{error:'请先登录'});return;}
        if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie','portfolio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');reply(res,200,{ok:true});return;}
        if(['/api/content','/api/preview-content'].includes(path)&&req.method==='GET'){reply(res,200,JSON.parse(await readFile(draftPath,'utf8')));return;}
        if(path==='/api/content'&&req.method==='PUT'){const data=validateContent((await jsonBody(req)).content);await atomic(draftPath,JSON.stringify(data,null,2));reply(res,200,{ok:true,message:'草稿已保存'});return;}
        if(path==='/api/publish'&&req.method==='POST'){
          if(publishing){reply(res,409,{error:'正在发布，请稍后'});return;}publishing=true;
          try{const data=publicContent(JSON.parse(await readFile(draftPath,'utf8')));await mkdir(join(local,'backups'),{recursive:true});await writeFile(join(local,'backups',`content-${Date.now()}.json`),await readFile(join(site,'content.json')));await atomic(join(site,'content.json'),JSON.stringify(data,null,2));if(buildOnPublish)await build(root);reply(res,200,{ok:true,projects:data.projects.length,message:'已发布到本地网站。可继续同步到公开站点。'});}finally{publishing=false;}return;
        }
        if(path==='/api/upload'&&req.method==='POST'){
          const body=await jsonBody(req,7_200_000);const bytes=Buffer.from(String(body.data||''),'base64');
          let ext='';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')ext='webp';
          if(!ext||bytes.length>5_000_000||bytes.length<20){reply(res,400,{error:'仅支持 5MB 以内 PNG/JPG/WebP 图片'});return;}
          const name=createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.'+ext;await writeFile(join(site,'media/uploads',name),bytes);reply(res,200,{ok:true,url:'media/uploads/'+name});return;
        }
        if(path==='/api/deploy'&&req.method==='POST'){
          if(root!==ROOT){reply(res,403,{error:'测试环境不能发布'});return;}if(deploying){reply(res,409,{error:'正在同步'});return;}deploying=true;try{reply(res,200,{ok:true,...await deploy()});}finally{deploying=false;}return;
        }
        reply(res,404,{error:'接口不存在'});return;
      }
      const isAdmin=path.startsWith('/admin');
      const base=isAdmin?admin:site;
      let relative=isAdmin?path.slice('/admin'.length):path;
      if(relative==='/'||relative==='')relative='/index.html';
      if(relative.split('/').some(p=>p.startsWith('.')||p==='tests'||p==='qa')){reply(res,404,{error:'不存在'});return;}
      const file=resolve(base,'.'+relative);
      if(!file.startsWith(base+sep)){reply(res,404,{error:'不存在'});return;}
      let info;try{info=await stat(file);}catch{reply(res,404,{error:'不存在'});return;}if(!info.isFile()){reply(res,404,{error:'不存在'});return;}
      res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Accept-Ranges','bytes');
      let start=0,end=info.size-1,status=200;
      if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}else{start=Math.max(0,info.size-Number(match[2]));}if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}
      res.setHeader('Content-Length',end-start+1);res.writeHead(status);if(req.method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).pipe(res);
    }catch(error){if(!res.headersSent)reply(res,error.status||400,{error:error.message||'请求失败'});else res.end();}
  });return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8766);const app=await createPortfolioServer({port});app.listen(port,'127.0.0.1',()=>console.log(`Portfolio: http://127.0.0.1:${port}/\nCMS: http://127.0.0.1:${port}/admin/\nLocal access details: .local/admin-access.txt`));
}
