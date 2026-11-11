const OWNER='Agent-QingJiu',REPO='Python-Build-Core',e=id=>document.getElementById(id);let job=null,timer=null,activeRun=null,uploadStarted=0;
const show=s=>e('status').textContent=s;
function extraResources(){
 const files=[...e('extraFiles').files].map(file=>({file,path:file.name}));
 const folders=[...e('extraFolder').files].map(file=>({file,path:file.webkitRelativePath||file.name}));
 const target=e('extraTarget').value.trim().replaceAll('\\','/')||'.';
 if(target.startsWith('/')||target.split('/').some(x=>x==='..'||x==='')||target.includes(':'))throw Error('附加资源内部位置不合法');
 const result=[...files,...folders].map(x=>({...x,path:(target==='.'?'':target+'/')+x.path.replaceAll('\\','/')}));

 if(result.some(x=>x.path.split('/').some(t=>t==='..'||t==='')||x.path.includes(':')||x.path.startsWith('/')))throw Error('附加资源包含非法路径');
 if(new Set(result.map(x=>x.path.toLowerCase())).size!==result.length)throw Error('附加资源存在同名冲突，请调整位置');
 return result;
}
function renderExtras(){try{const list=extraResources();e('extraList').textContent=list.length?('共 '+list.length+' 个文件，'+bytes(list.reduce((a,x)=>a+x.file.size,0))+'；目录结构原样保留\n'+list.slice(0,80).map(x=>x.path+' · '+bytes(x.file.size)).join('\n')+(list.length>80?'\n……其余 '+(list.length-80)+' 个文件已省略显示':'')):'尚未选择附加资源'}catch(err){e('extraList').textContent=err.message}}
['extraFiles','extraFolder','extraTarget'].forEach(id=>e(id).addEventListener('change',renderExtras));
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
  const extras=extraResources();
  const estimated=file.size+(icon?.size||0)+extras.reduce((sum,x)=>sum+x.file.size,0);
  if(extras.some(x=>x.file.size>18*1024*1024))throw Error('存在超过 18MB 的单个附加文件：请将大型资源放入项目 ZIP，或使用外部资源下载方案');
  if(mode==='onefile'&&estimated>1024**3)throw Error('单文件预计超过 1024MB，禁止打包');
  if(mode==='onefile'&&estimated>512*1024**2&&!confirm('源文件已经超过 512MB，建议使用目录模式。仍然继续吗？'))return;
  const id='job-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),prefix='jobs/'+id;
  const config={type:kind,name,entry:e('entry').value.trim(),mode,windowed:e('windowed').checked,auto_deps:e('auto').checked,packages:e('packages').value,hidden_imports:e('hidden').value.split(/[\s,;]+/).filter(Boolean),smoke_test:e('smoke').checked,extra_archives:[]};
  progress(5,'检查授权');show('验证 Token 对私有仓库的访问权限……');
  await api('/repos/'+OWNER+'/'+REPO);
  progress(10,'上传源码');show('上传源码：'+bytes(file.size)+'\n任务：'+id);
  await upload(prefix+'/input.'+kind,file);
  progress(20,'源码上传完成');if(icon){show('上传 ICO 图标');await upload(prefix+'/icon.ico',icon)}
  if(extras.length){
    if(typeof JSZip==='undefined')throw Error('ZIP 组件未加载，请刷新页面重试');
    let archive=new JSZip(),size=0,part=0;
    const flush=async()=>{
      if(!size)return;
      show('正在压缩并上传资源分包 '+(part+1));
      const blob=await archive.generateAsync({type:'blob',compression:'STORE'});
      if(blob.size>25*1024*1024)throw Error('资源分包超过 GitHub API 限制');
      await upload(prefix+'/resources/'+part+'.zip',blob);
      config.extra_archives.push('resources/'+part+'.zip');
      part++;archive=new JSZip();size=0;
    };
    for(const item of extras){
      if(size+item.file.size>18*1024*1024)await flush();
      archive.file(item.path,item.file,{createFolders:true});size+=item.file.size;
    }
    await flush();
  }
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
  {
   const artifacts=await api('/repos/'+OWNER+'/'+REPO+'/actions/runs/'+item.id+'/artifacts');
   const artifact=artifacts.artifacts.find(x=>x.name===(item.conclusion==='success'?'EXE-':'Diagnostics-')+job&&!x.expired);
   if(artifact){const btn=document.createElement('button');btn.textContent=item.conclusion==='success'?'下载 EXE 构建产物 ZIP':'下载失败诊断报告 ZIP';btn.onclick=async()=>{try{const token=e('token').value.trim();const res=await fetch('https://api.github.com/repos/'+OWNER+'/'+REPO+'/actions/artifacts/'+artifact.id+'/zip',{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!res.ok)throw Error('下载失败 '+res.status);const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=artifact.name+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}catch(err){show('下载失败：'+err.message+'\n可前往 Actions 页面手动下载')}};links.append(document.createTextNode(' '),btn)}
  }
 }
}
e('build').onclick=()=>build();
e('refresh').onclick=()=>refresh().catch(err=>show('查询失败：'+err.message));
e('source').addEventListener('change',async()=>{const f=e('source').files[0];if(!f)return;const name=f.name.replace(/\.(py|zip)$/i,'').replace(/[^a-zA-Z0-9_.-]/g,'_');if(name)e('name').value=name.slice(0,60);if(f.name.endsWith('.py')){const text=await f.text();const found=[...text.matchAll(/^(?:from|import)\s+([A-Za-z_][\w]*)/gm)].map(x=>x[1]);const known={PySide6:'PySide6',PyQt6:'PyQt6',PIL:'Pillow',cv2:'opencv-python',requests:'requests',numpy:'numpy',pandas:'pandas',yaml:'PyYAML',bs4:'beautifulsoup4',flask:'flask',fastapi:'fastapi',tkinter:null};const deps=[...new Set(found.filter(x=>known[x]).map(x=>known[x]))];if(deps.length&&!e('packages').value.trim())e('packages').value=deps.join('\n');if(found.includes('tkinter')||found.includes('PySide6')||found.includes('PyQt6'))e('windowed').checked=true;show('智能预检测：'+(deps.join(', ')||'未发现已知第三方依赖')+'\n请检查识别结果后再提交。')}});

const TOKEN_KEY='python-build-center-token-v1';
const tokenField=e('token'),remember=e('rememberToken'),tokenStatus=e('tokenStatus');
function saveToken(){
 try{
  if(remember.checked){
   if(tokenField.value.trim()){localStorage.setItem(TOKEN_KEY,tokenField.value.trim());tokenStatus.textContent='已保存在此浏览器';}
   else{localStorage.removeItem(TOKEN_KEY);tokenStatus.textContent='未保存 Token';}
  }else{localStorage.removeItem(TOKEN_KEY);tokenStatus.textContent='不会保存 Token';}
 }catch(err){tokenStatus.textContent='浏览器禁止本地存储，请手动输入 Token';}
}
try{
 const saved=localStorage.getItem(TOKEN_KEY);
 if(saved){tokenField.value=saved;remember.checked=true;tokenStatus.textContent='已从此浏览器读取 Token';}
 else tokenStatus.textContent='仅在你信任的私人电脑上启用记住功能';
}catch(err){tokenStatus.textContent='当前浏览器不支持本地保存';}
tokenField.addEventListener('change',saveToken);
tokenField.addEventListener('blur',saveToken);
remember.addEventListener('change',saveToken);
e('clearToken').addEventListener('click',()=>{
 try{localStorage.removeItem(TOKEN_KEY)}catch(err){}
 tokenField.value='';remember.checked=false;tokenStatus.textContent='已清除当前浏览器保存的 Token';
});
