const $=s=>document.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,tab='projects',selected=0,dirty=false,busy=false;
const tabs={projects:'作品管理',profile:'个人资料',experience:'实习经历',education:'教育经历',campus:'校园经历',honors:'荣誉奖项',skills:'技能清单',settings:'站点设置'};
const fields={
 projects:[['title','项目名称'],['subtitle','副标题'],['slug','页面标识（小写英文与连字符）'],['category','分类'],['status','状态','select',['draft','published']],['sortOrder','展示顺序','number'],['year','年份（未确认可留空）'],['art','主题封面','select',['agent','health','route','vehicle','campus','home','chat','bookmark']],['summary','一句话概述','textarea'],['description','项目介绍','textarea'],['technologies','技术栈（每行一项）','lines'],['highlights','具体实践（每行一项）','lines'],['flow','实现流程（每行一步）','lines'],['cover','封面地址（留空使用主题视觉）'],['sourceUrl','内容来源网址'],['featured','精选项目','boolean']],
 profile:[['name','中文姓名'],['englishName','英文姓名'],['brand','品牌名称'],['positioning','个人定位'],['location','所在城市'],['email','联系邮箱'],['github','GitHub 网址'],['resumeUrl','完整简历网址'],['intro','个人介绍','textarea']],
 experience:[['company','公司'],['department','部门'],['role','岗位'],['period','日期'],['description','经历介绍','textarea'],['highlights','具体实践（每行一项）','lines']],
 education:[['school','学校'],['major','专业'],['degree','学历'],['period','日期'],['ranking','排名（如前 10%）']],
 campus:[['organization','组织'],['role','岗位'],['period','日期'],['description','经历介绍','textarea']],
 honors:[['name','奖项名称'],['awards','获奖等级（每行一项）','lines'],['role','担任角色'],['count','数量（没有可留空）','number']],
 skills:[['category','技能分组'],['items','技能（每行一项）','lines']],
 settings:[['title','页面标题'],['description','搜索描述','textarea'],['heroHeading','首屏主标题'],['heroEmphasis','首屏强调标题'],['heroTagline','首屏中文标语'],['footerLine','页脚文案'],['copyright','版权文字']]
};
async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const json=await r.json();if(!r.ok)throw new Error(json.error||'请求失败');return json;}
function notice(text,error=false){$('#notice').textContent=text;$('#notice').classList.toggle('error',error);}
function current(){return ['profile','settings'].includes(tab)?data[tab]:(data[tab]||[])[selected];}
function titleOf(item){return item.title||item.company||item.school||item.role||item.category||item.name||'新条目';}
function render(){
 $('#tab-title').textContent=tabs[tab];document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));
 const list=Array.isArray(data[tab]);if(list)selected=Math.max(0,Math.min(selected,data[tab].length-1));const item=current();
 const left=list?`<div class="item-list">${data[tab].map((x,i)=>`<button type="button" data-select="${i}" class="${i===selected?'active':''}">${esc(titleOf(x))}<span>${tab==='projects'?(x.status==='published'?'已发布':'草稿'):esc(x.period||'')}</span></button>`).join('')}<button class="new-item" id="add-item">＋ 新增${tabs[tab].replace('管理','')}</button></div>`:'';
 const form=item?`<section class="form-panel"><div class="form-heading"><h2>${list?esc(titleOf(item)):tabs[tab]}</h2>${list?'<button class="danger" id="remove-item" type="button">移除条目</button>':''}</div><div class="form-grid">${fields[tab].map(([key,label,type='text',options])=>{const v=item[key]??'';const wide=['textarea','lines'].includes(type);let control;if(type==='select')control=`<select data-field="${key}">${options.map(o=>`<option value="${o}" ${v===o?'selected':''}>${o==='draft'?'草稿':o==='published'?'发布':o}</option>`).join('')}</select>`;else if(type==='boolean')control=`<input data-field="${key}" type="checkbox" ${v?'checked':''}>`;else if(wide)control=`<textarea data-field="${key}" data-type="${type}" rows="${key==='description'?5:3}">${esc(type==='lines'?(Array.isArray(v)?v:[]).join('\n'):v)}</textarea>`;else control=`<input data-field="${key}" data-type="${type}" type="${type}" value="${esc(v)}">`;return `<label class="${wide?'field-wide':''} ${type==='boolean'?'boolean-label':''}">${esc(label)}${control}</label>`;}).join('')}</div>${tab==='projects'?`<div class="upload-row"><label>上传封面（PNG/JPG/WebP，最大 5MB）<input id="cover-upload" type="file" accept="image/png,image/jpeg,image/webp"></label></div>${item.cover?`<img class="cover-preview" alt="封面预览" src="/${esc(item.cover)}">`:''}<p class="data-note">状态选择“草稿”可下线作品。保存草稿后预览；只有点击“发布到本地”才会更新正式内容。</p>`:''}</section>`:'<div class="empty">还没有条目。点击新增开始。</div>';
 $('#editor').innerHTML=`<div class="${list?'editor-layout':''}">${left}${form}</div>`;
}
async function save(){await api('content','PUT',{content:data});dirty=false;notice('草稿已保存。正式网站保持原样。');}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('.actions button').forEach(b=>b.disabled=true);try{await fn();}catch(error){notice(error.message,true);}finally{busy=false;document.querySelectorAll('.actions button').forEach(b=>b.disabled=false);}}
async function load(){data=await api('content');$('#login-view').hidden=true;$('#studio').hidden=false;render();}
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('login','POST',{password:$('#password').value});$('#password').value='';await load();}catch(error){$('#login-error').textContent=error.message;}});
document.querySelector('nav').addEventListener('click',event=>{const b=event.target.closest('[data-tab]');if(b){tab=b.dataset.tab;selected=0;render();}});
$('#editor').addEventListener('input',event=>{const f=event.target.closest('[data-field]');if(!f)return;const item=current(),key=f.dataset.field;item[key]=f.type==='checkbox'?f.checked:f.dataset.type==='number'?(f.value===''?'':Number(f.value)):f.dataset.type==='lines'?f.value.split('\n').map(s=>s.trim()).filter(Boolean):f.value;dirty=true;notice('有未保存的修改。');});
$('#editor').addEventListener('click',event=>{const b=event.target.closest('[data-select]');if(b){selected=Number(b.dataset.select);render();return;}if(event.target.id==='add-item'){data[tab]||=[];const slug='project-'+Date.now().toString(36);data[tab].push(tab==='projects'?{id:slug,slug,title:'新项目',category:'全栈应用',status:'draft',sortOrder:data[tab].length,art:'agent',technologies:[],highlights:[],flow:[]}:{});selected=data[tab].length-1;dirty=true;render();}if(event.target.id==='remove-item'){data[tab].splice(selected,1);selected=Math.max(0,selected-1);dirty=true;render();notice('条目已从草稿移除；发布后才影响正式网站。');}});
$('#editor').addEventListener('change',async event=>{if(event.target.id!=='cover-upload')return;const file=event.target.files[0];if(!file)return;if(file.size>5_000_000){notice('封面必须小于 5MB',true);return;}await action(async()=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const result=await api('upload','POST',{data:btoa(binary)});current().cover=result.url;dirty=true;render();notice('封面已上传，保存草稿后可预览。');});});
$('#save').addEventListener('click',()=>action(save));
$('#preview').addEventListener('click',()=>{
 if(busy)return;
 const previewWindow=window.open('about:blank','_blank');
 if(previewWindow)previewWindow.opener=null;
 action(async()=>{await save();if(previewWindow)previewWindow.location.href='/?preview=1';else notice('草稿已保存。浏览器阻止了新窗口，请打开 /?preview=1 查看。');});
});
$('#publish').addEventListener('click',()=>action(async()=>{await save();const result=await api('publish','POST');notice(result.message);render();}));
$('#deploy').addEventListener('click',()=>action(async()=>{await save();await api('publish','POST');notice('正在同步到公开站点…');const result=await api('deploy','POST');notice(result.message);}));
$('#logout').addEventListener('click',async()=>{await api('logout','POST');location.reload();});
addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
load().catch(()=>{});
