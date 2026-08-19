
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
let registerMode=false;
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',...opt});const data=await r.json().catch(()=>({}));if(!r.ok){const base=data.error||'request_failed';const message=data.detail?base+': '+data.detail:base;throw new Error(message)}return data}
function setMode(){registerMode=!registerMode;$('#authTitle').textContent=registerMode?'Create organization':'Sign in';$('#authBtn').textContent=registerMode?'Create account':'Sign in';$('#orgField').classList.toggle('hidden',!registerMode);$('#name').required=registerMode;$('#toggleAuth').textContent=registerMode?'Back to sign in':'Create an organization'}
$('#toggleAuth').onclick=e=>{e.preventDefault();setMode()};
$('#authForm').onsubmit=async e=>{e.preventDefault();$('#authMsg').textContent='Working...';try{const path=registerMode?'/api/auth/register':'/api/auth/login';const body=registerMode?{organization_name:$('#org').value,name:$('#name').value,email:$('#email').value,password:$('#password').value}:{email:$('#email').value,password:$('#password').value};const r=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=r.user.name+' · '+(r.user.company_name||'');$('#authMsg').textContent='Loading dashboard...';try{await refresh();$('#authMsg').textContent=''}catch(e){$('#authMsg').textContent='Dashboard error: '+e.message}}catch(err){$('#authMsg').textContent=err.message}}
$('#logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});location.reload()};
$$('.tabs button').forEach(b=>b.onclick=()=>{$$('.tabs button').forEach(x=>x.classList.add('secondary'));b.classList.remove('secondary');$$('.tab').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.tab).classList.remove('hidden');if(b.dataset.tab==='jobs')loadJobs();if(b.dataset.tab==='candidates')loadCandidates();if(b.dataset.tab==='applications')loadApps()});
async function loadJobs(){const jobs=await api('/api/jobs');$('#jobsBody').innerHTML=jobs.map(j=>`<tr><td>${esc(j.title)}</td><td>${esc(j.location||'-')}</td><td>${new Date(j.created_at).toLocaleString()}</td></tr>`).join('');$('#candidateJob').innerHTML='<option value="">Attach to job (optional)</option>'+jobs.map(j=>`<option value="${j.id}">${esc(j.title)}</option>`).join('')}
async function loadCandidates(){const rows=await api('/api/candidates');$('#candidatesBody').innerHTML=rows.map(x=>'<tr><td>'+esc(x.cv_url||x.full_name||'-')+'</td><td>'+esc(x.job_title||'-')+'</td><td>'+(x.score==null?'-':x.score)+'</td><td><span class="pill">'+esc(x.status||'Uploaded')+'</span></td></tr>').join('')}
async function loadApps(){
  try{
    const rows=await api('/api/applications');
    $('#appsBody').innerHTML=rows.map(x=>{
      const score=x.screening_score==null?'-':x.screening_score;
      return '<tr><td>'+esc(x.candidate_name||'CV Candidate')+'</td><td>'+esc(x.job_title||'-')+'</td><td><strong>'+score+'</strong></td><td><span class="pill">'+esc(x.status||'Review')+'</span></td><td><button type="button" class="btn secondary" onclick="extractCv(\''+x.id+'\')">Extract CV</button> <button type="button" class="btn secondary" onclick="rule(\''+x.id+'\')">Rule</button> <button type="button" class="btn" onclick="ai(\''+x.id+'\')">AI Screen</button></td></tr>';
    }).join('');
  }catch(e){
    $('#appsBody').innerHTML='<tr><td colspan="5">Screening load failed: '+esc(e.message)+'</td></tr>';
  }
}

function resultEsc(v){return esc(v==null?"":String(v))}
function resultList(v){
  let a=v;
  if(typeof a==="string"){try{a=JSON.parse(a)}catch{a=a.split(/\n|,/).map(x=>x.trim()).filter(Boolean)}}
  return Array.isArray(a)?a.filter(Boolean):[]
}

(function(){
  if(document.getElementById('screening-result-ui-style'))return;
  const s=document.createElement('style');s.id='screening-result-ui-style';
  s.textContent=`
    #resultText{white-space:normal!important}
    .screen-result-card{border:1px solid #dbe4f0;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 6px 20px rgba(15,23,42,.06)}
    .screen-result-top{padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:18px;border-bottom:1px solid #e8edf5}
    .screen-eyebrow{font-size:11px;letter-spacing:.08em;font-weight:800;color:#64748b;margin-bottom:5px}
    .screen-result-title{font-size:21px;font-weight:750;color:#102a4c}
    .screen-score{min-width:110px;text-align:center;padding:10px 14px;border-radius:14px;background:#f8fafc}
    .screen-score-number{font-size:34px;font-weight:800;line-height:1;color:#102a4c}.screen-score-label{font-size:13px;color:#64748b}
    .score-strong{background:#ecfdf5}.score-strong .screen-score-number{color:#047857}
    .score-good{background:#eff6ff}.score-good .screen-score-number{color:#1d4ed8}
    .score-review{background:#fff7ed}.score-review .screen-score-number{color:#c2410c}
    .score-low{background:#fff1f2}.score-low .screen-score-number{color:#be123c}
    .screen-status-row{padding:14px 24px 0}.screen-status{display:inline-flex;padding:6px 11px;border-radius:999px;font-size:12px;font-weight:700}
    .status-strong{background:#dcfce7;color:#166534}.status-potential{background:#dbeafe;color:#1d4ed8}.status-low{background:#fee2e2;color:#991b1b}.status-review{background:#f1f5f9;color:#475569}
    .screen-section{padding:20px 24px 0}.screen-section-title{font-size:13px;font-weight:750;color:#17365d;margin-bottom:9px}
    .screen-summary,.screen-recommendation{font-size:14px;line-height:1.65;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:13px 15px}
    .screen-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 24px 0}.screen-panel{border:1px solid #e2e8f0;border-radius:12px;padding:15px}
    .screen-list{margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.7}.screen-empty{color:#94a3b8;font-size:13px}
    .skill-wrap{display:flex;flex-wrap:wrap;gap:7px}.skill-chip{padding:6px 9px;border-radius:999px;font-size:12px;font-weight:650}.skill-match{background:#ecfdf5;color:#047857}.skill-missing{background:#fff1f2;color:#be123c}
    .screen-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.screen-meta div{padding:11px;border:1px solid #e2e8f0;border-radius:10px}.screen-meta span{display:block;font-size:11px;color:#94a3b8;margin-bottom:4px}.screen-meta strong{font-size:13px;color:#334155}
    .screen-recommendation{margin:20px 24px 24px;background:#f8fafc}
    .screen-error-card{border:1px solid #fecaca;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 6px 20px rgba(127,29,29,.05)}
    .screen-error-head{padding:20px 24px;background:#fff7f7;border-bottom:1px solid #fee2e2;display:flex;justify-content:space-between;align-items:center;gap:12px}
    .screen-error-title{font-size:19px;font-weight:750;color:#991b1b}.screen-error-sub{font-size:12px;color:#9f1239;margin-top:4px}
    .screen-error-icon{width:36px;height:36px;border-radius:50%;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-weight:800}
    .screen-error-body{padding:20px 24px}.screen-error-message{font-size:14px;line-height:1.6;color:#7f1d1d}
    .screen-error-code{display:inline-block;margin-top:12px;padding:5px 9px;border-radius:7px;background:#fef2f2;color:#991b1b;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace}
    .screen-error-action{margin-top:14px;padding:12px 14px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:12px}
    @media(max-width:700px){.screen-result-top{align-items:flex-start}.screen-grid,.screen-meta{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
})();

function renderScreeningResult(data){
  const box=$('#result'),out=$('#resultText'); box.classList.remove('hidden');
  if(data&&data.error){
    const detail=data.detail||data.message||data.error;
    let title='AI screening could not be completed', message='The AI service could not process this screening request.', action='Please check the AI service configuration and available credits, then try again.';
    if(String(data.error)==='cv_not_extracted'){title='CV extraction required';message='This candidate has not been extracted yet.';action='Click “Extract CV” first, then run AI Screening.'}
    else if(String(data.error)==='ai_not_configured'){title='AI service is not configured';message='No AI provider is currently configured for this workspace.';action='Add a valid AI API configuration before running screening.'}
    else if(String(data.error)==='ai_request_failed'){title='AI screening temporarily unavailable';message='The AI provider rejected or could not complete this request.';action='Check API credits/quota and configuration, then retry. No candidate score was changed.'}
    else if(String(data.error)==='cv_extraction_failed'){title='CV extraction failed';message='The CV could not be processed by the extraction service.';action='Retry extraction after the AI service is available.'}
    out.innerHTML='<div class="screen-error-card"><div class="screen-error-head"><div><div class="screen-error-title">'+resultEsc(title)+'</div><div class="screen-error-sub">AI Screening</div></div><div class="screen-error-icon">!</div></div><div class="screen-error-body"><div class="screen-error-message">'+resultEsc(message)+'</div><div class="screen-error-action">'+resultEsc(action)+'</div><div class="screen-error-code">'+resultEsc(data.error)+'</div></div></div>';
    return;
  }
  const score=Number(data?.overall_score??data?.ai_score), hasScore=Number.isFinite(score);
  const status=String(data?.status||data?.ai_recommendation||"Review");
  const summary=String(data?.summary||data?.ai_summary||"");
  const strengths=resultList(data?.strengths||data?.ai_strengths);
  const gaps=resultList(data?.gaps||data?.weaknesses||data?.ai_weaknesses);
  const matched=resultList(data?.matched_skills||data?.ai_matched_skills);
  const missing=resultList(data?.missing_skills||data?.ai_missing_skills);
  const education=String(data?.education||""),position=String(data?.current_position||"");
  const experience=data?.experience_years;
  const recommendation=String(data?.recommendation||data?.ai_recommendation||"");
  const scoreClass=!hasScore?"score-na":score>=85?"score-strong":score>=70?"score-good":score>=50?"score-review":"score-low";
  const statusClass=/strong/i.test(status)?"status-strong":/potential/i.test(status)?"status-potential":/low/i.test(status)?"status-low":"status-review";
  const listHtml=(items,empty)=>items.length?'<ul class="screen-list">'+items.map(x=>'<li>'+resultEsc(x)+'</li>').join('')+'</ul>':'<div class="screen-empty">'+resultEsc(empty)+'</div>';
  out.innerHTML='<div class="screen-result-card">'+
    '<div class="screen-result-top"><div><div class="screen-eyebrow">AI SCREENING RESULT</div><div class="screen-result-title">Candidate assessment</div></div>'+
    '<div class="screen-score '+scoreClass+'"><span class="screen-score-number">'+(hasScore?resultEsc(score):'—')+'</span><span class="screen-score-label">/ 100</span></div></div>'+
    '<div class="screen-status-row"><span class="screen-status '+statusClass+'">'+resultEsc(status)+'</span></div>'+
    (summary?'<div class="screen-section"><div class="screen-section-title">Assessment Summary</div><div class="screen-summary">'+resultEsc(summary)+'</div></div>':'')+
    '<div class="screen-grid"><div class="screen-panel"><div class="screen-section-title">Strengths</div>'+listHtml(strengths,'No strengths identified yet.')+'</div>'+
    '<div class="screen-panel"><div class="screen-section-title">Areas to Review</div>'+listHtml(gaps.length?gaps:missing,'No gaps identified yet.')+'</div></div>'+
    ((matched.length||missing.length)?'<div class="screen-section"><div class="screen-section-title">Skills Match</div><div class="skill-wrap">'+matched.map(x=>'<span class="skill-chip skill-match">✓ '+resultEsc(x)+'</span>').join('')+missing.map(x=>'<span class="skill-chip skill-missing">× '+resultEsc(x)+'</span>').join('')+'</div></div>':'')+
    ((education||position||experience!=null)?'<div class="screen-section"><div class="screen-section-title">Profile Snapshot</div><div class="screen-meta">'+
      (position?'<div><span>Current Position</span><strong>'+resultEsc(position)+'</strong></div>':'')+
      (experience!=null?'<div><span>Experience</span><strong>'+resultEsc(experience)+' years</strong></div>':'')+
      (education?'<div><span>Education</span><strong>'+resultEsc(education)+'</strong></div>':'')+
      '</div></div>':'')+
    (recommendation?'<div class="screen-recommendation"><div class="screen-section-title">Recommendation</div><div>'+resultEsc(recommendation)+'</div></div>':'')+
    '</div>';
}

async function extractCv(id){
  if(window.extractingCv)return;
  window.extractingCv=true;
  const box=$('#result');
  const out=$('#resultText');
  box.classList.remove('hidden');
  out.textContent='Extracting CV from R2...';
  try{
    const r=await api('/api/candidates/extract',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({application_id:id})
    });
    renderScreeningResult(r.extraction||r);
    await refresh();
    await loadApps();
  }catch(e){
    out.textContent='CV extraction failed: '+e.message;
  }finally{
    window.extractingCv=false;
  }
}
async function refresh(){const d=await api('/api/dashboard');$('#mJobs').textContent=d.jobs;$('#mCandidates').textContent=d.candidates;$('#mApplications').textContent=d.applications;$('#mStrong').textContent=d.strong_matches;await loadJobs()}
$('#jobForm').onsubmit=async e=>{
  e.preventDefault();
  const msg=$('#jobMsg');
  msg.textContent='Creating job...';
  try{
    const r=await api('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      title:$('#jobTitle').value,
      location:$('#jobLocation').value,
      description:$('#jobDescription').value,
      requirements:$('#jobSkills').value.split(',').map(x=>x.trim()).filter(Boolean)
    })});
    e.target.reset();
    msg.textContent='Job created successfully.';
    await refresh();
  }catch(err){
    msg.textContent='Create job failed: '+err.message;
  }
}
$('#candidateForm').onsubmit=async e=>{
  e.preventDefault();
  const files=[...$('#candidateFiles').files,...$('#candidateFolder').files];
  const unique=[];
  const seen=new Set();
  for(const file of files){
    const key=file.name+'|'+file.size+'|'+file.lastModified;
    if(!seen.has(key)){seen.add(key);unique.push(file)}
  }
  if(!$('#candidateJob').value){$('#candidateMsg').textContent='Pilih posisi/job terlebih dahulu.';return}
  if(!unique.length){$('#candidateMsg').textContent='Pilih file CV atau folder CV terlebih dahulu.';return}
  if(unique.length>50){$('#candidateMsg').textContent='Maksimal 50 CV per upload.';return}

  const msg=$('#candidateMsg');
  const errors=[];
  let uploaded=0;

  // Upload one CV per request. This avoids a large multipart request hanging
  // when many PDF/DOCX files are selected at once.
  for(let i=0;i<unique.length;i++){
    const file=unique[i];
    msg.textContent='Uploading CV '+(i+1)+'/'+unique.length+': '+file.name;
    const fd=new FormData();
    fd.append('job_id',$('#candidateJob').value);
    fd.append('files',file,file.name);
    try{
      const r=await api('/api/candidates/upload',{method:'POST',body:fd});
      if(r.uploaded)uploaded+=r.uploaded;
      else uploaded++;
    }catch(err){
      errors.push(file.name+': '+err.message);
    }
  }

  if(errors.length){
    msg.textContent=uploaded+' CV berhasil, '+errors.length+' gagal. '+errors.slice(0,3).join(' | ');
  }else{
    msg.textContent=uploaded+' CV berhasil diupload.';
  }

  e.target.reset();
  await refresh();
  await loadCandidates();
}
window.rule=async id=>{try{const r=await api('/api/screenings/rule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({application_id:id})});showResult(r);await refresh();loadApps()}catch(e){showResult({error:e.message})}}
window.ai=async id=>{try{const r=await api('/api/ai/screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({application_id:id})});showResult(r);await refresh();loadApps()}catch(e){showResult({error:e.message})}}
function showResult(x){renderScreeningResult(x)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
async function boot(){try{const r=await api('/api/auth/me');$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=r.user.name+' · '+(r.user.company_name||'');await refresh();$('#authMsg').textContent=''}catch(e){$('#authMsg').textContent='Login/session error: '+e.message;$('#auth').classList.remove('hidden');$('#app').classList.add('hidden')}}
boot();
