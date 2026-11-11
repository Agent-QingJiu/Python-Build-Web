const OWNER='Agent-QingJiu',REPO='Python-Build-Core',e=id=>document.getElementById(id);let job=null,timer=null,activeRun=null,uploadStarted=0;
const show=s=>e('status').textContent=s;
function progress(n,label){n=Math.max(0,Math.min(100,n));e('fill').style.width=n+'%';e('progress').setAttribute('aria-valuenow',String(n));e('phase').textContent=label;e('percent').textContent=n+'% · 阶段进度（非 PyInstaller 实时百分比）'}
e('kind').onchange=()=>{e('source').accept='.'+e('kind').value;e('source').value=''};
async function api(path,method='GET',body){
 const token=e('token').value.trim();if(!token)throw Error('请先填写 GitHub Token');
 const response=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok){const detail=(await response.text()).slice(0,350);if(response.status===404&&path.includes('/contents/'))throw Error('上传返回 404：Token 无法访问私有仓库 '+OWNER+'/'+REPO+'，请确认 Fine-grained Token 已选择该仓库且 Contents 为 Read and write。GitHub 原始响应：'+detail);throw Error('GitHub API '+response.status+'：'+detail)}
 return response.status===204?null:response.json();
}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}
async function upload(path,file){const bytes=new Uint8Array(await file.arrayBuffer());progress(12,'读取文件 '+bytes.length+' 字节');await api('/repos/'+OWNER+'/'+REPO+'/contents/'+path,'PUT',{message:'Build upload '+path,content:b64(bytes),branch:'main'})}
function bytes(n){return (n/1024/1024).toFixed(1)+' MB'}
async function build(){
 e('build').disabled=true;clearInterval(timer);
 try{
  const file=e('source').files[0],kind=e('kind').value;
  if(!file||!file.name.toLowerCase().endsWith('.'+kind))throw Error('请选择有效的 .'+kind+' 文件');
  if(file.size>25*1024*1024)throw Error('源码文件不能超过 25MB');
  const name=e('name').value.trim();
  if(!/^[A-Za-z0-9_.-]{1,60}$/.test(name))throw Error('软件名称只允许英文字母、数字、下划线、点和短横线');
  const mode=e('mode').value;
  const icon=e('icon').files[0];
  if(icon&&(!icon.name.toLowerCase().endsWith('.ico')||icon.size>1024*1024))throw Error('ICO 图标需小于 1MB');
  const estimated=file.size+(icon?.size||0);
  if(mode==='onefile'&&estimated>1024**3)throw Error('单文件预计超过 1024MB，禁止打包');
  if(mode==='onefile'&&estimated>512*1024**2&&!confirm('源文件已经超过 512MB，建议使用目录模式。仍然继续吗？'))return;
  const id='job-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),prefix='jobs/'+id;
  const config={type:kind,name,entry:e('entry').value.trim(),mode,windowed:e('windowed').checked,auto_deps:e('auto').checked,packages:e('packages').value,hidden_imports:e('hidden').value.split(/[\s,;]+/).filter(Boolean)};
  progress(5,'检查授权');show('验证 Token 对私有仓库的访问权限……');
  await api('/repos/'+OWNER+'/'+REPO);
  progress(10,'上传源码');show('上传源码：'+bytes(file.size)+'\n任务：'+id);
  await upload(prefix+'/input.'+kind,file);
  progress(20,'源码上传完成');if(icon){show('上传 ICO 图标');await upload(prefix+'/icon.ico',icon)}
  await upload(prefix+'/config.json',new Blob([JSON.stringify(config)]));progress(30,'准备构建');
  show('提交 GitHub Actions 构建任务');
  await api('/repos/'+OWNER+'/'+REPO+'/actions/workflows/build.yml/dispatches','POST',{ref:'main',inputs:{job_id:id,python_version:e('python').value}});
  job=id;progress(35,'等待 Windows Runner');show('任务已提交：'+id+'\n正在等待 GitHub Runner 分配……');
  timer=setInterval(()=>{refresh().catch(err=>show('状态刷新失败：'+err.message))},5000);await refresh();
 }catch(err){progress(0,'提交失败');show('失败：'+err.message)}finally{e('build').disabled=false}
}
async function refresh(){
 if(!job)throw Error('还没有提交构建任务');
 const r=await api('/repos/'+OWNER+'/'+REPO+'/actions/workflows/build.yml/runs?per_page=100');
 const item=r.workflow_runs.find(x=>x.display_title&&x.display_title.includes(job));
 if(!item){progress(35,'等待任务同步');show('任务 '+job+' 已提交，等待 Actions 列表同步……');return}
 if(item.status==='queued'||item.status==='waiting'||item.status==='pending')progress(40,'排队等待 Windows Runner');
 else if(item.status==='in_progress'){
   let stepText='Windows Runner 已启动';
   try{
     const details=await api('/repos/'+OWNER+'/'+REPO+'/actions/runs/'+item.id+'/jobs?per_page=20');
     const steps=(details.jobs||[]).flatMap(j=>j.steps||[]);
     const running=steps.find(x=>x.status==='in_progress');
     const current=running||[...steps].reverse().find(x=>x.status==='completed');
     if(current){
       const label=current.name||'构建中';
       const lower=label.toLowerCase();
       const value=lower.includes('checkout')?45:lower.includes('setup')?50:lower.includes('cache')?55:lower.includes('install')?62:lower==='build'?77:lower.includes('upload')?92:lower.includes('delete')?97:65;
       progress(value,label);stepText='当前步骤：'+label;
     }else progress(44,'Runner 启动中');
   }catch(err){progress(60,'构建中（步骤暂不可用）');stepText='步骤读取暂不可用：'+err.message}
   show('任务：'+job+'\n状态：'+item.status+'\n'+stepText+'\n更新时间：'+item.updated_at);
 } else if(item.status==='completed')progress(item.conclusion==='success'?100:100,item.conclusion==='success'?'构建成功':'构建结束：'+item.conclusion);
 if(item.status!=='in_progress')show('任务：'+job+'\n状态：'+item.status+'\n结果：'+(item.conclusion||'执行中')+'\n更新：'+item.updated_at);
 const links=e('links');links.replaceChildren();
 const a=document.createElement('a');a.href=item.html_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='查看 GitHub Actions 构建日志';links.append(a);
 if(item.status==='completed'){
  clearInterval(timer);
  if(item.conclusion==='success'){
   const artifacts=await api('/repos/'+OWNER+'/'+REPO+'/actions/runs/'+item.id+'/artifacts');
   const artifact=artifacts.artifacts.find(x=>x.name==='EXE-'+job&&!x.expired);
   if(artifact){const btn=document.createElement('button');btn.textContent='下载 EXE 构建产物 ZIP';btn.onclick=async()=>{try{const token=e('token').value.trim();const res=await fetch('https://api.github.com/repos/'+OWNER+'/'+REPO+'/actions/artifacts/'+artifact.id+'/zip',{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!res.ok)throw Error('下载失败 '+res.status);const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=artifact.name+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}catch(err){show('下载失败：'+err.message+'\n可前往 Actions 页面手动下载')}};links.append(document.createTextNode(' '),btn)}
  }
 }
}
e('build').onclick=()=>build();
e('refresh').onclick=()=>refresh().catch(err=>show('查询失败：'+err.message));
e('source').addEventListener('change',async()=>{const f=e('source').files[0];if(!f)return;const name=f.name.replace(/\.(py|zip)$/i,'').replace(/[^a-zA-Z0-9_.-]/g,'_');if(name)e('name').value=name.slice(0,60);if(f.name.endsWith('.py')){const text=await f.text();const found=[...text.matchAll(/^(?:from|import)\s+([A-Za-z_][\w]*)/gm)].map(x=>x[1]);const known={PySide6:'PySide6',PyQt6:'PyQt6',PIL:'Pillow',cv2:'opencv-python',requests:'requests',numpy:'numpy',pandas:'pandas',yaml:'PyYAML',bs4:'beautifulsoup4',flask:'flask',fastapi:'fastapi',tkinter:null};const deps=[...new Set(found.filter(x=>known[x]).map(x=>known[x]))];if(deps.length&&!e('packages').value.trim())e('packages').value=deps.join('\n');if(found.includes('tkinter')||found.includes('PySide6')||found.includes('PyQt6'))e('windowed').checked=true;show('智能预检测：'+(deps.join(', ')||'未发现已知第三方依赖')+'\n请检查识别结果后再提交。')}});
