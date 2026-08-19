import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

interface Env {
  DB: D1Database;
  CV_BUCKET: R2Bucket;
  APP_NAME: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  SESSION_SECRET?: string;
}

type AuthUser = { id:string; company_id:string; name:string; email:string; role:string; company_name:string };

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
app.use("*", secureHeaders());
app.use("/api/*", cors({ origin: (origin) => origin || "*", allowMethods: ["GET","POST","PATCH","DELETE","OPTIONS"], allowHeaders: ["Content-Type","Authorization"], credentials: true }));
const id=()=>crypto.randomUUID(); const enc=new TextEncoder();
function b64url(bytes:Uint8Array){let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function hex(bytes:Uint8Array){return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function sha256(v:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))))}
async function passwordHash(password:string){const salt=new Uint8Array(16);crypto.getRandomValues(salt);const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);return `pbkdf2$100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`}
async function passwordVerify(password:string,stored:string){try{const [scheme,it,saltText,expected]=stored.split("$");if(scheme!=="pbkdf2")return false;const sb=saltText.replace(/-/g,"+").replace(/_/g,"/");const bin=atob(sb+"=".repeat((4-sb.length%4)%4));const salt=Uint8Array.from(bin,c=>c.charCodeAt(0));const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);const iterations=Math.min(Number(it)||100000,100000);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations,hash:"SHA-256"},key,256);return b64url(new Uint8Array(bits))===expected}catch{return false}}
function cookieToken(req:Request){
  const h=req.headers.get("Cookie")||"";
  return h.match(/(?:^|;\s*)ats_session=([^;]+)/)?.[1]
    || h.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
    || null;
}
function setCookie(token:string,maxAge:number){
  return `ats_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
function clearLegacyCookie(){
  return "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
}
async function columns(db:D1Database,table:string){const r=await db.prepare(`PRAGMA table_info(${table})`).all<any>();return new Set((r.results||[]).map((x:any)=>String(x.name)))}
async function createSession(c:any,u:AuthUser){
  const token=b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires=new Date(Date.now()+7*86400000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)")
    .bind(await sha256(token),u.id,expires).run();
  c.header("Set-Cookie",setCookie(token,7*86400));
}
async function currentUser(c:any):Promise<AuthUser|null>{
  const raw=cookieToken(c.req.raw);
  if(!raw)return null;
  try{
    const row=await c.env.DB.prepare(
      "SELECT u.id,u.company_id,u.name,u.email,u.role,COALESCE(cp.company_name,u.name) company_name " +
      "FROM sessions s JOIN users u ON u.id=s.user_id " +
      "LEFT JOIN company_profiles cp ON cp.user_id=u.company_id " +
      "WHERE s.token=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1"
    ).bind(await sha256(raw)).first<AuthUser>();
    return row||null;
  }catch(e:any){
    throw new Error("session_lookup_failed: "+String(e?.message||e));
  }
}
async function requireAuth(c:any,next:any){
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized"},401);
    c.set("user",u);await next();
  }catch(e:any){
    return c.json({error:"auth_failed",detail:String(e?.message||e)},500);
  }
}
async function audit(c:any,u:AuthUser,action:string,entityId?:string){try{const cs=await columns(c.env.DB,"admin_audit_logs");const fields:string[]=[];const vals:any[]=[];const add=(n:string,v:any)=>{if(cs.has(n)){fields.push(n);vals.push(v)}};add("id",id());add("user_id",u.id);add("action",action);add("entity_id",entityId||null);add("company_id",u.company_id);add("created_at",new Date().toISOString());if(fields.length)await c.env.DB.prepare(`INSERT INTO admin_audit_logs(${fields.join(",")}) VALUES(${fields.map(()=>"?").join(",")})`).bind(...vals).run()}catch{}}
async function appMeta(db:D1Database){const cs=await columns(db,"applications");return {cs,candidate:cs.has("candidate_id")?"candidate_id":cs.has("user_id")?"user_id":null,tenant:cs.has("company_id")?"company_id":cs.has("organization_id")?"organization_id":null}}
async function createApplication(c:any,u:AuthUser,jobId:string,candidateUserId:string){const m=await appMeta(c.env.DB);if(!m.candidate)throw new Error("applications_missing_candidate_key");const f=["id","job_id",m.candidate],v:any[]=[id(),jobId,candidateUserId];if(m.tenant){f.push(m.tenant);v.push(u.company_id)}if(m.cs.has("status")){f.push("status");v.push("Review")}if(m.cs.has("score")){f.push("score");v.push(0)}await c.env.DB.prepare(`INSERT INTO applications(${f.join(",")}) VALUES(${f.map(()=>"?").join(",")})`).bind(...v).run()}
app.get("/api/health",async c=>{try{await c.env.DB.prepare("SELECT 1").first();return c.json({ok:true,app:c.env.APP_NAME,version:"v6.33-job-actions-screening",database:"indo-talent-db",storage:"r2"})}catch{return c.json({ok:false,error:"database_unavailable"},503)}});
app.post("/api/auth/register",async c=>{
  try{
    const b=await c.req.json<any>();
    const company=String(b.organization_name||"").trim();
    const name=String(b.name||"").trim();
    const email=String(b.email||"").trim().toLowerCase();
    const password=String(b.password||"");
    if(!company||!name||!email||password.length<10)
      return c.json({error:"organization_name,name,email,password_min_10_required"},400);
    if(await c.env.DB.prepare("SELECT id FROM users WHERE email=? LIMIT 1").bind(email).first())
      return c.json({error:"email_already_registered"},409);

    const uid=id();
    const hash=await passwordHash(password);

    try{
      await c.env.DB.prepare(
        "INSERT INTO users(id,role,email,password_hash,name,status,company_id,approval_status,email_verified) VALUES(?,?,?,?,?,?,?,?,?)"
      ).bind(uid,"company",email,hash,name,"active",uid,"approved",0).run();
    }catch(e:any){
      return c.json({error:"registration_failed",stage:"users_insert",detail:String(e?.message||e)},500);
    }

    try{
      await c.env.DB.prepare(
        "INSERT INTO company_profiles(user_id,company_name,contact_name,contact_email,created_at,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
      ).bind(uid,company,name,email).run();
    }catch(e:any){
      await c.env.DB.prepare("DELETE FROM users WHERE id=?").bind(uid).run().catch(()=>{});
      return c.json({error:"registration_failed",stage:"company_profile_insert",detail:String(e?.message||e)},500);
    }

    const u:AuthUser={id:uid,company_id:uid,name,email,role:"company",company_name:company};
    try{
      await createSession(c,u);
    }catch(e:any){
      return c.json({error:"registration_failed",stage:"session_insert",detail:String(e?.message||e)},500);
    }
    await audit(c,u,"auth.register",uid);
    return c.json({user:u},201);
  }catch(e:any){
    return c.json({error:"registration_failed",stage:"request",detail:String(e?.message||e)},500);
  }
});
app.post("/api/auth/login",async c=>{
  try{
    const b=await c.req.json<any>();
    const email=String(b.email||"").trim().toLowerCase();
    const password=String(b.password||"");
    if(!email||!password)return c.json({error:"email_password_required"},400);
    const r=await c.env.DB.prepare(
      "SELECT u.id,u.company_id,u.name,u.email,u.password_hash,u.role,COALESCE(cp.company_name,u.name) company_name "+
      "FROM users u LEFT JOIN company_profiles cp ON cp.user_id=u.company_id "+
      "WHERE lower(u.email)=? LIMIT 1"
    ).bind(email).first<any>();
    if(!r)return c.json({error:"invalid_credentials"},401);
    if(!(await passwordVerify(password,r.password_hash)))return c.json({error:"invalid_credentials"},401);
    const u:AuthUser={id:r.id,company_id:r.company_id||r.id,name:r.name,email:r.email,role:r.role,company_name:r.company_name};
    await createSession(c,u);
    await audit(c,u,"auth.login",u.id);
    c.header("Cache-Control","no-store");
    return c.json({user:u});
  }catch(e:any){
    return c.json({error:"login_failed",detail:String(e?.message||e)},500);
  }
});
app.post("/api/auth/logout",async c=>{
  try{
    const raw=cookieToken(c.req.raw);
    if(raw)await c.env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(await sha256(raw)).run();
  }catch{}
  c.header("Set-Cookie",setCookie("",0));
  return c.json({ok:true});
});
app.get("/api/auth/me",requireAuth,c=>c.json({user:c.get("user")}));
app.get("/api/auth/status",async c=>{
  try{
    const u=await currentUser(c);
    return c.json({authenticated:!!u,cookie_present:!!cookieToken(c.req.raw),user:u?{id:u.id,role:u.role,company_id:u.company_id,email:u.email}:null});
  }catch(e:any){
    return c.json({authenticated:false,error:"auth_status_failed",detail:String(e?.message||e)},500);
  }
});
for(const p of ["/api/candidates","/api/applications","/api/dashboard","/api/screenings/*"])app.use(p,requireAuth);
app.get("/api/dashboard",async c=>{try{const u=c.get("user") as AuthUser;if(!u.company_id)return c.json({error:"company_id_missing"},403);const [j,ca,a]=await Promise.all([c.env.DB.prepare("SELECT COUNT(*) count FROM jobs WHERE company_id=?").bind(u.company_id).first<any>(),c.env.DB.prepare("SELECT COUNT(*) count FROM users WHERE company_id=? AND role='candidate'").bind(u.company_id).first<any>(),c.env.DB.prepare("SELECT COUNT(*) count FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=?").bind(u.company_id).first<any>()]);return c.json({jobs:Number(j?.count||0),candidates:Number(ca?.count||0),applications:Number(a?.count||0),strong_matches:0})}catch(e:any){return c.json({error:"dashboard_query_failed",detail:String(e?.message||e)},500)}});
app.get("/api/jobs",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized",stage:"job_auth",cookie_present:!!cookieToken(c.req.raw)},401);
    if(!u.company_id)return c.json({error:"company_context_missing"},400);
    const rows=await c.env.DB.prepare(
      "SELECT id,title,location,salary,description,status,created_at FROM jobs WHERE company_id=? AND COALESCE(status,'open')<>'deleted' ORDER BY created_at DESC"
    ).bind(u.company_id).all();
    return c.json(rows.results||[]);
  }catch(e:any){
    return c.json({error:"job_list_failed",detail:String(e?.message||e)},500);
  }
});

app.patch("/api/jobs/:id",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized",stage:"job_auth"},401);
    if(!u.company_id)return c.json({error:"company_context_missing"},400);
    if(u.role!=="company"&&u.role!=="admin")return c.json({error:"company_role_required",stage:"job_auth",role:u.role},403);
    const jid=c.req.param("id");
    const existing=await c.env.DB.prepare("SELECT id,title,location,salary,description,status FROM jobs WHERE id=? AND company_id=? LIMIT 1").bind(jid,u.company_id).first<any>();
    if(!existing||existing.status==='deleted')return c.json({error:"job_not_found"},404);
    const b=await c.req.json<any>();
    const title=String(b.title??existing.title??"").trim();
    const location=String(b.location??existing.location??"").trim();
    const salary=String(b.salary??existing.salary??"").trim();
    const description=String(b.description??existing.description??"").trim();
    const requirements=Array.isArray(b.requirements)?b.requirements.map((x:any)=>String(x).trim()).filter(Boolean):[];
    if(!title||!description)return c.json({error:"title,description_required"},400);
    const finalDescription=description.replace(/\n\nRequired skills:\n(?:- .*\n?)+$/i,"").trim() + (requirements.length?"\n\nRequired skills:\n"+requirements.map((x:string)=>"- "+x).join("\n"):"");
    await c.env.DB.prepare("UPDATE jobs SET title=?,location=?,salary=?,description=? WHERE id=? AND company_id=?").bind(title,location,salary,finalDescription,jid,u.company_id).run();
    await audit(c,u,"job.update",jid);
    return c.json({ok:true,id:jid,title,location,salary,description:finalDescription,status:existing.status||'open'});
  }catch(e:any){
    return c.json({error:"job_update_failed",detail:String(e?.message||e)},500);
  }
});

app.delete("/api/jobs/:id",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized",stage:"job_auth"},401);
    if(!u.company_id)return c.json({error:"company_context_missing"},400);
    if(u.role!=="company"&&u.role!=="admin")return c.json({error:"company_role_required",stage:"job_auth",role:u.role},403);
    const jid=c.req.param("id");
    const existing=await c.env.DB.prepare("SELECT id,title,status FROM jobs WHERE id=? AND company_id=? LIMIT 1").bind(jid,u.company_id).first<any>();
    if(!existing||existing.status==='deleted')return c.json({error:"job_not_found"},404);
    // Soft delete: keep applications/screening history intact while removing the job from the active workspace.
    await c.env.DB.prepare("UPDATE jobs SET status='deleted' WHERE id=? AND company_id=?").bind(jid,u.company_id).run();
    await audit(c,u,"job.delete",jid);
    return c.json({ok:true,id:jid,deleted:true});
  }catch(e:any){
    return c.json({error:"job_delete_failed",detail:String(e?.message||e)},500);
  }
});

// Compatibility endpoints: some managed proxies are stricter with PATCH/DELETE.
app.post("/api/jobs/:id/update",async c=>{
  const req=new Request(c.req.raw.url.replace(`/api/jobs/${c.req.param("id")}/update`,`/api/jobs/${c.req.param("id")}`),{method:"PATCH",headers:c.req.raw.headers,body:await c.req.raw.clone().text()});
  return app.fetch(req,c.env);
});
app.post("/api/jobs/:id/delete",async c=>{
  const req=new Request(c.req.raw.url.replace(`/api/jobs/${c.req.param("id")}/delete`,`/api/jobs/${c.req.param("id")}`),{method:"DELETE",headers:c.req.raw.headers});
  return app.fetch(req,c.env);
});

app.post("/api/jobs",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized",stage:"job_auth",cookie_present:!!cookieToken(c.req.raw)},401);
    if(!u.company_id)return c.json({error:"company_context_missing",stage:"job_auth"},400);
    if(u.role!=="company"&&u.role!=="admin")return c.json({error:"company_role_required",stage:"job_auth",role:u.role},403);

    const b=await c.req.json<any>();
    const title=String(b.title||"").trim();
    const location=String(b.location||"").trim();
    const salary=String(b.salary||"").trim();
    const description=String(b.description||"").trim();
    const requirements=Array.isArray(b.requirements)?b.requirements.map((x:any)=>String(x).trim()).filter(Boolean):[];
    if(!title||!description)return c.json({error:"title,description_required"},400);

    const finalDescription=requirements.length
      ? description+"\n\nRequired skills:\n"+requirements.map((x:string)=>"- "+x).join("\n")
      : description;

    const jid=id();
    await c.env.DB.prepare(
      "INSERT INTO jobs(id,company_id,title,location,salary,description,status,created_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)"
    ).bind(jid,u.company_id,title,location,salary,finalDescription,"open").run();

    await audit(c,u,"job.create",jid);
    return c.json({ok:true,id:jid,title},201);
  }catch(e:any){
    return c.json({error:"job_create_failed",detail:String(e?.message||e)},500);
  }
});
app.get("/api/candidates",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized"},401);
    const rows=await c.env.DB.prepare(
      "SELECT cu.id,cu.name candidate_name,cp.cv_url,cp.full_name,cp.headline,cp.summary,"+
      "a.id application_id,a.job_id,j.title job_title,a.status,a.score "+
      "FROM users cu "+
      "LEFT JOIN candidate_profiles cp ON cp.user_id=cu.id "+
      "LEFT JOIN applications a ON a.candidate_id=cu.id "+
      "LEFT JOIN jobs j ON j.id=a.job_id "+
      "WHERE cu.company_id=? AND cu.role='candidate' "+
      "ORDER BY cu.created_at DESC"
    ).bind(u.company_id).all();
    return c.json(rows.results||[]);
  }catch(e:any){
    return c.json({error:"candidates_query_failed",detail:String(e?.message||e)},500);
  }
});

app.post("/api/candidates/upload",async c=>{
  try{
    const u=await currentUser(c);
    if(!u)return c.json({error:"unauthorized",stage:"candidate_upload_auth"},401);
    if(!u.company_id)return c.json({error:"company_context_missing"},400);
    if(u.role!=="company"&&u.role!=="admin")return c.json({error:"company_role_required"},403);

    const f=await c.req.formData();
    const jobId=String(f.get("job_id")||"").trim();
    const incoming=f.getAll("files").filter((x:any)=>x instanceof File) as File[];

    if(!jobId)return c.json({error:"job_required"},400);
    if(!incoming.length)return c.json({error:"cv_files_required"},400);
    if(incoming.length>50)return c.json({error:"too_many_files_max_50"},400);

    const job=await c.env.DB.prepare(
      "SELECT id,title FROM jobs WHERE id=? AND company_id=? AND status='open' LIMIT 1"
    ).bind(jobId,u.company_id).first<any>();
    if(!job)return c.json({error:"job_not_found_or_closed"},404);

    const results:any[]=[];
    for(const file of incoming){
      if(file.size===0)continue;
      if(file.size>10*1024*1024){
        results.push({filename:file.name,status:"failed",error:"file_too_large_max_10mb"});
        continue;
      }

      const uid=id();
      const baseName=file.name
        .replace(/\.[^.]+$/,"")
        .replace(/[_-]+/g," ")
        .replace(/\s+/g," ")
        .trim();
      const candidateName=(baseName||"CV Candidate").slice(0,160);
      const email=`cv-${uid}@internal.invalid`;
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,160)||"cv";
      const key=`${u.company_id}/candidates/${uid}/${safeName}`;

      await c.env.CV_BUCKET.put(key,file.stream(),{
        httpMetadata:{contentType:file.type||"application/octet-stream"}
      });

      const textContent=file.type==="text/plain"
        ?(await file.text()).slice(0,100000)
        :"";

      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO users(id,role,email,password_hash,name,phone,status,company_id,approval_status) VALUES(?,?,?,?,?,?,?,?,?)"
        ).bind(uid,"candidate",email,"!cv-upload-no-login!",candidateName,null,"active",u.company_id,"approved"),
        c.env.DB.prepare(
          "INSERT INTO candidate_profiles(user_id,phone,full_name,cv_url,summary) VALUES(?,?,?,?,?)"
        ).bind(uid,null,candidateName,key,textContent)
      ]);

      await createApplication(c,u,jobId,uid);
      await audit(c,u,"candidate.upload",uid);

      results.push({
        id:uid,
        filename:file.name,
        job_id:job.id,
        job_title:job.title,
        status:"uploaded",
        extraction_status:file.type==="text/plain"?"complete":"pending"
      });
    }

    const uploaded=results.filter(x=>x.status==="uploaded").length;
    const failed=results.filter(x=>x.status==="failed").length;
    return c.json({ok:true,job_id:job.id,job_title:job.title,total:incoming.length,uploaded,failed,results},201);
  }catch(e:any){
    return c.json({error:"candidate_bulk_upload_failed",detail:String(e?.message||e)},500);
  }
});
app.get("/api/applications",async c=>{
  try{
    const u=c.get("user") as AuthUser;
    const m=await appMeta(c.env.DB);
    if(!m.candidate)return c.json({error:"applications_missing_candidate_key"},500);
    const tenant=m.tenant?`AND a.${m.tenant}=?`:"";
    const score=m.cs.has("ai_score")?"a.ai_score":m.cs.has("score")?"a.score":"NULL";
    const sql=`SELECT a.id,a.status,${score} screening_score,a.ai_recommendation,a.ai_summary,
      a.ai_strengths,a.ai_weaknesses,a.ai_matched_skills,a.ai_missing_skills,
      a.ai_interview_questions,j.id job_id,j.title job_title,cu.id candidate_id,
      cu.name candidate_name,cp.cv_url,cp.summary cv_summary,cp.skills,cp.experience_years
      FROM applications a
      JOIN jobs j ON j.id=a.job_id
      JOIN users cu ON cu.id=a.${m.candidate}
      LEFT JOIN candidate_profiles cp ON cp.user_id=cu.id
      WHERE j.company_id=? ${tenant}
      ORDER BY a.rowid DESC`;
    const params=m.tenant?[u.company_id,u.company_id]:[u.company_id];
    return c.json((await c.env.DB.prepare(sql).bind(...params).all()).results||[]);
  }catch(e:any){
    return c.json({error:"applications_query_failed",detail:String(e?.message||e)},500);
  }
});
app.post("/api/screenings/rule",async c=>{
  try{
    const u=c.get("user") as AuthUser;
    const b=await c.req.json<any>();
    const m=await appMeta(c.env.DB);
    if(!m.candidate)return c.json({error:"applications_missing_candidate_key"},500);
    const r=await c.env.DB.prepare(
      `SELECT a.id,j.title,j.description,cu.name,cp.skills,cp.experience_years,cp.summary,cp.current_position,cp.education,cp.languages
       FROM applications a JOIN jobs j ON j.id=a.job_id
       JOIN users cu ON cu.id=a.${m.candidate}
       LEFT JOIN candidate_profiles cp ON cp.user_id=cu.id
       WHERE a.id=? AND j.company_id=? LIMIT 1`
    ).bind(b.application_id,u.company_id).first<any>();
    if(!r)return c.json({error:"application_not_found"},404);
    const hasCvEvidence=Boolean(String(r.skills||r.summary||r.current_position||r.education||r.languages||"").trim() || Number(r.experience_years||0)>0);
    if(!hasCvEvidence)return c.json({error:"cv_not_extracted",message:"Extract the CV before running Rule Screening."},409);

    const norm=(v:any)=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9+#.\-\s]/g," ").replace(/\s+/g," ").trim();
    const jobText=norm(`${r.title||""} ${r.description||""}`);
    const profileText=norm(`${r.summary||""} ${r.current_position||""} ${r.skills||""} ${r.education||""} ${r.languages||""}`);
    const explicitSkills=String(r.description||"").match(/Required skills:\s*([\s\S]*)$/i)?.[1]||"";
    const explicitSkillTokens=explicitSkills.split(/[,\n;|]/).map((x:string)=>norm(x.replace(/^[-*•]\s*/,""))).filter((x:string)=>x.length>=3);

    // Only compare recognised job-relevant competencies. Do NOT turn ordinary JD words
    // such as "posisi", "departemen", "lokasi", "atasan", "langsung", etc. into skills.
    const skillMap:any[]=[
      ["accounting",["accounting","akuntansi","financial accounting"]],
      ["financial management",["financial management","manajemen keuangan","finance management"]],
      ["financial reporting",["financial reporting","financial report","laporan keuangan","laporan finansial"]],
      ["financial analysis",["financial analysis","analisis keuangan"]],
      ["budgeting",["budgeting","budget preparation","penyusunan anggaran","anggaran"]],
      ["forecasting",["forecasting","financial forecasting","proyeksi keuangan"]],
      ["financial planning",["financial planning","perencanaan keuangan"]],
      ["tax",["tax","taxation","pajak","perpajakan"]],
      ["audit",["audit","auditing","internal audit","audit internal"]],
      ["compliance",["compliance","regulatory compliance","kepatuhan"]],
      ["treasury",["treasury","cash management","manajemen kas"]],
      ["cash flow",["cash flow","arus kas"]],
      ["accounts payable",["accounts payable","account payable","utang usaha"]],
      ["accounts receivable",["accounts receivable","account receivable","piutang usaha"]],
      ["cost control",["cost control","cost management","pengendalian biaya"]],
      ["payroll",["payroll","penggajian"]],
      ["erp",["erp","sap","oracle erp","netsuite"]],
      ["microsoft excel",["microsoft excel","ms excel","excel"]],
      ["data analysis",["data analysis","data analytics","analisis data"]],
      ["leadership",["leadership","kepemimpinan"]],
      ["team management",["team management","people management","manajemen tim","memimpin tim"]],
      ["project management",["project management","manajemen proyek"]],
      ["communication",["communication","komunikasi"]],
      ["analytical thinking",["analytical thinking","analytical skills","berpikir analitis","analisis"]],
      ["attention to detail",["attention to detail","detail oriented","detail-oriented","ketelitian"]],
      ["decision making",["decision making","decision-making","pengambilan keputusan"]],
      ["integrity",["integrity","integritas"]],
      ["time management",["time management","manajemen waktu"]],
      ["problem solving",["problem solving","pemecahan masalah"]],
      ["risk management",["risk management","manajemen risiko"]],
      ["procurement",["procurement","purchasing","pengadaan"]],
      ["inventory management",["inventory management","stock management","manajemen persediaan"]],
      ["human resources",["human resources","human resource","hr","sumber daya manusia"]],
      ["recruitment",["recruitment","rekrutmen"]]
    ];
    const contains=(text:string,phrase:string)=>{const p=norm(phrase);return p&&(` ${text} `).includes(` ${p} `)};
    const requirements=[...new Set([
      ...skillMap.filter(([,aliases])=>aliases.some((x:string)=>contains(jobText,x))).map(([name])=>name),
      ...explicitSkillTokens.flatMap((token:string)=>{
        const hit=skillMap.find(([,aliases])=>aliases.some((x:string)=>contains(token,x)||contains(x,token)));
        return hit?[hit[0]]:[];
      })
    ])];
    const candidateSkills=skillMap.filter(([,aliases])=>aliases.some((x:string)=>contains(profileText,x))).map(([name])=>name);
    const matched=requirements.filter((x:string)=>candidateSkills.includes(x));
    const missing=requirements.filter((x:string)=>!candidateSkills.includes(x));
    const skillMatch=requirements.length?Math.round(matched.length/requirements.length*50):0;

    const exp=Number(r.experience_years||0);
    const yearMatch=jobText.match(/(?:minimum|minimal|at least|\b)\s*(\d+)\s*(?:\+\s*)?(?:years?|tahun)/i);
    const requiredYears=yearMatch?Number(yearMatch[1]):0;
    const experienceScore=requiredYears>0?Math.min(25,Math.round(Math.min(exp/requiredYears,1)*25)):
      (exp>=8?25:exp>=5?22:exp>=3?18:exp>=1?12:0);

    const title=norm(r.title);
    const titleTerms=[...new Set((title.match(/[a-z0-9+#.\-]{3,}/g)||[]).filter((x:string)=>!new Set(["manager","senior","junior","staff","lead","head","finance","the","and","dan","untuk"]).has(x)))];
    const roleSkillHints=skillMap.filter(([,aliases])=>aliases.some((x:string)=>contains(title,x))).map(([name])=>name);
    const roleHits=roleSkillHints.filter((x:string)=>candidateSkills.includes(x));
    const roleScore=roleSkillHints.length?Math.round(roleHits.length/roleSkillHints.length*15):(titleTerms.some((x:string)=>profileText.includes(x))?10:0);
    const completeness=[r.summary,r.current_position,r.education,r.skills,r.experience_years].filter((x:any)=>String(x??"").trim()!=="").length;
    const completenessScore=Math.min(10,Math.round((completeness/5)*10));
    const score=Math.max(0,Math.min(100,skillMatch+experienceScore+roleScore+completenessScore));
    const status=score>=85?"Strong Match":score>=70?"Potential Match":"Low Match";
    const breakdown={skills_match:{score:skillMatch,max:50},experience:{score:experienceScore,max:25},role_relevance:{score:roleScore,max:15},profile_completeness:{score:completenessScore,max:10}};
    const evidence=[
      exp?`${exp} year${exp===1?"":"s"} of experience`:"Experience duration not stated",
      r.current_position?`Current position: ${String(r.current_position)}`:"Current position not stated",
      ...matched.slice(0,6).map((x:string)=>`CV evidence includes ${x}`)
    ];
    const review=[...missing.slice(0,10).map((x:string)=>`${x} is required by the job but not evidenced in the CV`),...(exp===0?["Experience duration could not be verified from the extracted CV"]:[])];
    if(m.cs.has("ai_score")){
      await c.env.DB.prepare("UPDATE applications SET ai_score=?,status=?,ai_recommendation=?,ai_summary=?,ai_strengths=?,ai_weaknesses=?,ai_matched_skills=?,ai_missing_skills=?,ai_screened_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(score,status,"Rule-based screening",`Rule-based comparison of recognised job requirements against extracted CV evidence for ${r.title}.`,JSON.stringify(matched),JSON.stringify(review),JSON.stringify(matched),JSON.stringify(missing),b.application_id).run();
    }else if(m.cs.has("score")){
      await c.env.DB.prepare("UPDATE applications SET score=?,status=? WHERE id=?").bind(score,status,b.application_id).run();
    }else if(m.cs.has("status")){
      await c.env.DB.prepare("UPDATE applications SET status=? WHERE id=?").bind(status,b.application_id).run();
    }
    await audit(c,u,"screening.rule",b.application_id);
    return c.json({overall_score:score,status,matched_skills:matched,missing_skills:missing,requirements, candidate_skills:candidateSkills,evidence,areas_to_review:review,breakdown,note:"Rule-based screening compares recognised job requirements with evidence extracted from the candidate CV. Generic JD words are excluded."});
  }catch(e:any){return c.json({error:"rule_screen_failed",detail:String(e?.message||e)},500)}
});

async function extractCvWithOpenAI(c:any, fileKey:string, filename:string, mimeType:string){
  if(!c.env.OPENAI_API_KEY)throw new Error("ai_not_configured");
  const obj=await c.env.CV_BUCKET.get(fileKey);
  if(!obj)throw new Error("cv_file_not_found");
  const bytes=await obj.arrayBuffer();
  if(bytes.byteLength>12*1024*1024)throw new Error("cv_file_too_large_for_extraction");
  const base64=Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join("");
  const dataUrl=`data:${mimeType||"application/octet-stream"};base64,${btoa(base64)}`;
  const schema={
    type:"object",additionalProperties:false,
    properties:{
      education:{type:"string"},
      experience_years:{type:"integer",minimum:0,maximum:60},
      current_position:{type:"string"},
      skills:{type:"array",items:{type:"string"}},
      languages:{type:"array",items:{type:"string"}},
      headline:{type:"string"},
      summary:{type:"string"},
      work_history:{type:"array",items:{type:"string"}},
      achievements:{type:"array",items:{type:"string"}}
    },
    required:["education","experience_years","current_position","skills","languages","headline","summary","work_history","achievements"]
  };
  const resp=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${c.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:c.env.OPENAI_MODEL||"gpt-5.6-luna",
      store:false,
      instructions:"Extract job-relevant information from this CV. Do not extract or return email, phone number, address, date of birth, gender, religion, race, marital status, photo details, national ID, or other protected/sensitive personal information. Do not invent missing facts. Use an empty string/array or 0 when evidence is absent. Return structured JSON only.",
      input:[{role:"user",content:[
        {type:"input_text",text:`Extract the CV for screening. Filename: ${filename}`},
        {type:"input_file",file_data:dataUrl,filename:filename}
      ]}],
      text:{format:{type:"json_schema",name:"cv_extraction",strict:true,schema}}
    })
  });
  if(!resp.ok){
    const errText=await resp.text();
    throw new Error(`openai_extraction_failed_${resp.status}:${errText.slice(0,300)}`);
  }
  const d=await resp.json() as any;
  const content=d?.output?.flatMap((x:any)=>x?.content||[]).find((x:any)=>x?.type==="output_text")?.text;
  if(!content)throw new Error("empty_extraction_response");
  return JSON.parse(content);
}

app.post("/api/candidates/extract",async c=>{
  try{
    const u=await currentUser(c);if(!u)return c.json({error:"unauthorized",stage:"cv_extract_auth"},401);
    const b=await c.req.json<any>();
    const m=await appMeta(c.env.DB);
    if(!m.candidate)return c.json({error:"applications_missing_candidate_key"},500);
    const r=await c.env.DB.prepare(
      `SELECT a.id application_id,a.${m.candidate} candidate_id,cp.cv_url,cp.full_name
       FROM applications a
       JOIN jobs j ON j.id=a.job_id
       JOIN users cu ON cu.id=a.${m.candidate}
       LEFT JOIN candidate_profiles cp ON cp.user_id=cu.id
       WHERE a.id=? AND j.company_id=? LIMIT 1`
    ).bind(b.application_id,u.company_id).first<any>();
    if(!r)return c.json({error:"application_not_found"},404);
    if(!r.cv_url)return c.json({error:"cv_file_missing"},404);
    const filename=String(r.cv_url).split("/").pop()||"cv";
    const lower=filename.toLowerCase();
    const mime=lower.endsWith(".pdf")?"application/pdf":lower.endsWith(".docx")?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"text/plain";
    const data=await extractCvWithOpenAI(c,r.cv_url,filename,mime);
    const summary=String(data.summary||"").slice(0,10000);
    const skills=JSON.stringify(data.skills||[]);
    const languages=JSON.stringify(data.languages||[]);
    const history=JSON.stringify(data.work_history||[]);
    const achievements=JSON.stringify(data.achievements||[]);
    const headline=String(data.headline||"").slice(0,500);
    const currentPosition=String(data.current_position||"").slice(0,500);
    const education=String(data.education||"").slice(0,1000);
    const cols=await c.env.DB.prepare("PRAGMA table_info(candidate_profiles)").all<any>();
    const cs=new Set((cols.results||[]).map((x:any)=>x.name));
    const sets:string[]=[];const vals:any[]=[];
    const add=(col:string,val:any)=>{if(cs.has(col)){sets.push(`${col}=?`);vals.push(val)}};
    add("education",education);add("experience_years",Number(data.experience_years||0));add("current_position",currentPosition);
    add("skills",skills);add("languages",languages);add("headline",headline);add("summary",summary);
    add("updated_at",new Date().toISOString());
    if(sets.length){
      vals.push(r.candidate_id);
      await c.env.DB.prepare(`UPDATE candidate_profiles SET ${sets.join(",")} WHERE user_id=?`).bind(...vals).run();
    }
    return c.json({ok:true,application_id:r.application_id,filename,extraction:data});
  }catch(e:any){
    const msg=String(e?.message||e);
    const status=msg==="ai_not_configured"?503:msg==="cv_file_not_found"?404:500;
    return c.json({error:msg==="ai_not_configured"?"ai_not_configured":"cv_extraction_failed",detail:msg},status);
  }
});

app.post("/api/ai/screen",async c=>{
  try{
    const u=await currentUser(c);if(!u)return c.json({error:"unauthorized",stage:"ai_screen_auth"},401);
    if(!u.company_id)return c.json({error:"company_context_missing"},400);
    if(!c.env.OPENAI_API_KEY)return c.json({error:"ai_not_configured",message:"Set OPENAI_API_KEY as a Worker secret."},503);
    const b=await c.req.json<any>(),m=await appMeta(c.env.DB);if(!m.candidate)return c.json({error:"applications_missing_candidate_key"},500);
    const r=await c.env.DB.prepare(`SELECT a.id,j.title,j.description,cu.name,cp.summary,cp.skills,cp.experience_years,cp.education,cp.current_position,cp.languages,cp.headline FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users cu ON cu.id=a.${m.candidate} LEFT JOIN candidate_profiles cp ON cp.user_id=cu.id WHERE a.id=? AND j.company_id=? LIMIT 1`).bind(b.application_id,u.company_id).first<any>();
    if(!r)return c.json({error:"application_not_found"},404);
    const schema={type:"object",additionalProperties:false,properties:{overall_score:{type:"integer",minimum:0,maximum:100},summary:{type:"string"},matched_skills:{type:"array",items:{type:"string"}},missing_skills:{type:"array",items:{type:"string"}},evidence:{type:"array",items:{type:"string"}},areas_to_review:{type:"array",items:{type:"string"}},breakdown:{type:"object",additionalProperties:false,properties:{skills_match:{type:"integer",minimum:0,maximum:50},experience:{type:"integer",minimum:0,maximum:25},role_relevance:{type:"integer",minimum:0,maximum:15},profile_completeness:{type:"integer",minimum:0,maximum:10}},required:["skills_match","experience","role_relevance","profile_completeness"]},recommendation:{type:"string"},interview_questions:{type:"array",items:{type:"string"}}},required:["overall_score","summary","matched_skills","missing_skills","evidence","areas_to_review","breakdown","recommendation","interview_questions"]};
    const prompt=`You are an expert recruitment screening engine. Compare the JOB REQUIREMENTS with the CANDIDATE CV evidence. IMPORTANT: Do not extract ordinary prose words from the job description as skills. Words such as position, department, location, direct, general, work, description, responsibility, etc. are NOT skills. Only return genuine job-relevant competencies, tools, certifications, domain knowledge, or clearly stated role requirements. Matched skills must be explicitly evidenced in the CV. Missing skills means requirements present in the job but not evidenced in the CV; do not claim a skill is missing if the job never requires it. Score transparently: skills_match max 50, experience max 25, role_relevance max 15, profile_completeness max 10. overall_score MUST equal the sum of those four breakdown values. Use only job-relevant evidence. Never infer protected traits or personal data. Do not use candidate name in scoring.\n\nJOB TITLE: ${r.title}\nJOB DESCRIPTION: ${String(r.description||"").slice(0,16000)}\n\nCANDIDATE CV PROFILE:\nHEADLINE=${r.headline||""}\nSUMMARY=${r.summary||""}\nEDUCATION=${r.education||""}\nCURRENT_POSITION=${r.current_position||""}\nSKILLS=${r.skills||""}\nLANGUAGES=${r.languages||""}\nEXPERIENCE_YEARS=${r.experience_years||0}`;
    const resp=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${c.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:c.env.OPENAI_MODEL||"gpt-5.6",store:false,instructions:"Return structured JSON only.",input:prompt,text:{format:{type:"json_schema",name:"candidate_screening",strict:true,schema}}})});
    if(!resp.ok){const t=await resp.text();return c.json({error:"ai_request_failed",status:resp.status,detail:t.slice(0,500)},502)}
    const d=await resp.json() as any,content=d?.output?.flatMap((x:any)=>x?.content||[]).find((x:any)=>x?.type==="output_text")?.text;if(!content)return c.json({error:"empty_ai_response"},502);
    let result:any;try{result=JSON.parse(content)}catch{return c.json({error:"invalid_ai_json"},502)}
    const bd=result.breakdown||{};const computed=Number(bd.skills_match||0)+Number(bd.experience||0)+Number(bd.role_relevance||0)+Number(bd.profile_completeness||0);result.overall_score=Math.max(0,Math.min(100,computed));result.status=result.overall_score>=85?"Strong Match":result.overall_score>=70?"Potential Match":"Low Match";
    if(m.cs.has("ai_score"))await c.env.DB.prepare("UPDATE applications SET ai_score=?,status=?,ai_summary=?,ai_strengths=?,ai_weaknesses=?,ai_matched_skills=?,ai_missing_skills=?,ai_recommendation=?,ai_interview_questions=?,ai_model=?,ai_screened_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.overall_score,result.status,result.summary,JSON.stringify(result.evidence),JSON.stringify(result.areas_to_review),JSON.stringify(result.matched_skills),JSON.stringify(result.missing_skills),result.recommendation,JSON.stringify(result.interview_questions),c.env.OPENAI_MODEL||"gpt-5.6",b.application_id).run();
    else if(m.cs.has("score"))await c.env.DB.prepare("UPDATE applications SET score=?,status=? WHERE id=?").bind(result.overall_score,result.status,b.application_id).run();
    else if(m.cs.has("status"))await c.env.DB.prepare("UPDATE applications SET status=? WHERE id=?").bind(result.status,b.application_id).run();
    await audit(c,u,"screening.ai",b.application_id);return c.json(result);
  }catch(e:any){return c.json({error:"ai_screen_failed",detail:String(e?.message||e)},500)}
});

app.get("/", (c) => c.html(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.env.APP_NAME}</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#10213b;background:#f6f8fb}body{margin:0}header{background:#fff;border-bottom:1px solid #e5eaf2;padding:18px 28px;display:flex;justify-content:space-between;align-items:center}main{max-width:1180px;margin:28px auto;padding:0 20px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px}.brand img{width:42px;height:42px;object-fit:contain}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#fff;border:1px solid #e4e9f1;border-radius:16px;padding:20px;box-shadow:0 3px 14px #132b4a0a;margin-bottom:18px}.metric b{font-size:30px;display:block;margin-top:8px}.tabs{display:flex;gap:8px;margin:18px 0}.tabs button,.btn{border:0;border-radius:10px;padding:10px 14px;background:#0b66ff;color:white;cursor:pointer}.tabs button.secondary,.btn.secondary{background:#edf2f8;color:#20304a}.hidden{display:none}.auth{max-width:480px;margin:60px auto}.input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d7deea;border-radius:10px;margin:6px 0 12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:11px;border-bottom:1px solid #edf0f5}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#edf4ff}.danger{color:#b42318}.logo{max-width:58px;max-height:58px}@media(max-width:800px){.grid,.row{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}}
.upload-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}.upload-option{border:1px solid #d7deea;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;font-weight:600}.upload-option input{width:100%}@media(max-width:700px){.upload-options{grid-template-columns:1fr}}
.screen-result-card{border:1px solid #dbe3ef;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.screen-result-top{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;border-bottom:1px solid #e7edf5}
.screen-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;color:#64748b;margin-bottom:5px}
.screen-result-title{font-size:20px;font-weight:750;color:#0f172a}
.screen-score{min-width:100px;text-align:center;padding:10px 14px;border-radius:14px}
.screen-score-number{font-size:30px;font-weight:800;line-height:1}
.screen-score-label{font-size:12px;color:#64748b;margin-left:3px}
.score-strong{background:#ecfdf3;color:#047857}.score-good{background:#eff6ff;color:#1d4ed8}.score-review{background:#fff7ed;color:#c2410c}.score-low{background:#fef2f2;color:#b91c1c}.score-na{background:#f1f5f9;color:#64748b}
.screen-status-row{padding:14px 24px 0}
.screen-status{display:inline-flex;padding:6px 11px;border-radius:999px;font-size:12px;font-weight:700}
.status-strong{background:#dcfce7;color:#166534}.status-potential{background:#dbeafe;color:#1d4ed8}.status-low{background:#fee2e2;color:#b91c1c}.status-review{background:#f1f5f9;color:#475569}
.screen-section{padding:20px 24px 0}
.screen-section-title{font-size:13px;font-weight:750;color:#334155;margin-bottom:9px}
.screen-summary{font-size:14px;line-height:1.65;color:#475569}
.screen-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 24px 0}
.screen-panel{border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc}
.screen-list{margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.7}
.screen-empty{font-size:13px;color:#94a3b8}
.skill-wrap{display:flex;flex-wrap:wrap;gap:7px}
.skill-chip{display:inline-flex;padding:6px 9px;border-radius:8px;font-size:12px;font-weight:600}
.skill-match{background:#ecfdf5;color:#047857}.skill-missing{background:#fff1f2;color:#be123c}
.screen-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.screen-meta>div{border:1px solid #e2e8f0;border-radius:10px;padding:11px 12px;background:#f8fafc}
.screen-meta span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}
.screen-meta strong{display:block;font-size:13px;color:#0f172a}
.screen-recommendation{margin:20px 24px 24px;padding:15px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:10px;color:#334155;font-size:14px;line-height:1.6}
.screen-error{padding:20px 22px;border:1px solid #fecaca;background:#fff7f7;border-radius:12px}
.screen-error-title{font-size:16px;font-weight:750;color:#991b1b;margin-bottom:6px}
.screen-error-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#b91c1c;margin-bottom:7px}
.screen-error-detail{font-size:13px;line-height:1.6;color:#64748b;white-space:pre-wrap}
@media(max-width:700px){.screen-result-top{align-items:flex-start;flex-direction:column}.screen-grid,.screen-meta{grid-template-columns:1fr}}

.screen-result-card{border:1px solid #dbe3ef;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.screen-result-top{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;border-bottom:1px solid #e7edf5}
.screen-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;color:#64748b;margin-bottom:5px}
.screen-result-title{font-size:20px;font-weight:750;color:#0f172a}
.screen-score{min-width:100px;text-align:center;padding:10px 14px;border-radius:14px}
.screen-score-number{font-size:30px;font-weight:800;line-height:1}
.screen-score-label{font-size:12px;color:#64748b;margin-left:3px}
.score-strong{background:#ecfdf3;color:#047857}.score-good{background:#eff6ff;color:#1d4ed8}.score-review{background:#fff7ed;color:#c2410c}.score-low{background:#fef2f2;color:#b91c1c}.score-na{background:#f1f5f9;color:#64748b}
.screen-status-row{padding:14px 24px 0}.screen-status{display:inline-flex;padding:6px 11px;border-radius:999px;font-size:12px;font-weight:700}
.status-strong{background:#dcfce7;color:#166534}.status-potential{background:#dbeafe;color:#1d4ed8}.status-low{background:#fee2e2;color:#b91c1c}.status-review{background:#f1f5f9;color:#475569}
.screen-section{padding:20px 24px 0}.screen-section-title{font-size:13px;font-weight:750;color:#334155;margin-bottom:9px}.screen-summary{font-size:14px;line-height:1.65;color:#475569}
.screen-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 24px 0}.screen-panel{border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc}
.screen-list{margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.7}.screen-empty{font-size:13px;color:#94a3b8}
.skill-wrap{display:flex;flex-wrap:wrap;gap:7px}.skill-chip{display:inline-flex;padding:6px 9px;border-radius:8px;font-size:12px;font-weight:600}.skill-match{background:#ecfdf5;color:#047857}.skill-missing{background:#fff1f2;color:#be123c}
.screen-recommendation{margin:20px 24px 24px;padding:15px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:10px;color:#334155;font-size:14px;line-height:1.6}
.screen-error{display:flex;gap:14px;align-items:flex-start;padding:20px 22px;border:1px solid #fecaca;background:#fff7f7;border-radius:12px}
.screen-error-icon{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:12px;flex:none}
.screen-error-title{font-size:16px;font-weight:750;color:#991b1b;margin-bottom:6px}.screen-error-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#b91c1c;margin-bottom:7px}.screen-error-detail{font-size:13px;line-height:1.6;color:#64748b;white-space:pre-wrap}.screen-error-action{margin-top:10px;padding:10px 12px;background:#fff;border-radius:8px;color:#475569;font-size:12px;line-height:1.5}
@media(max-width:700px){.screen-result-top{align-items:flex-start;flex-direction:column}.screen-grid{grid-template-columns:1fr}}
</style></head><body>
<div id="auth" class="auth card"><div class="brand"><img src="/logo.png" onerror="this.style.display='none'"><span>${c.env.APP_NAME}</span></div><h2 id="authTitle">Sign in</h2><p class="muted">Secure recruiter workspace with tenant isolation.</p><form id="authForm"><div id="orgField" class="hidden"><label>Organization</label><input class="input" id="org" autocomplete="organization"></div><label>Name</label><input class="input" id="name" autocomplete="name"><label>Email</label><input class="input" id="email" type="email" autocomplete="email" required><label>Password</label><input class="input" id="password" type="password" minlength="10" autocomplete="current-password" required><button class="btn" id="authBtn">Sign in</button></form><p><button class="btn secondary" id="toggleAuth">Create an organization</button></p><div id="authMsg" class="muted"></div></div>
<div id="app" class="hidden"><header><div class="brand"><img src="/logo.png" onerror="this.style.display='none'"><span>${c.env.APP_NAME}</span></div><div><span id="who" class="muted"></span> <button class="btn secondary" id="logout">Logout</button></div></header><main><div class="tabs"><button data-tab="overview">Overview</button><button class="secondary" data-tab="jobs">Jobs</button><button class="secondary" data-tab="candidates">Candidates</button><button class="secondary" data-tab="applications">Screening</button></div>
<section id="overview" class="tab"><div class="grid"><div class="card metric">Jobs<b id="mJobs">0</b></div><div class="card metric">Candidates<b id="mCandidates">0</b></div><div class="card metric">Applications<b id="mApplications">0</b></div><div class="card metric">Strong matches<b id="mStrong">0</b></div></div><div class="card"><div class="section-head"><div><h2>AI Screening</h2><p class="muted">Create jobs, manage positions, upload CVs, attach candidates to jobs, then run rule-based or AI screening.</p></div><button class="btn" type="button" id="manageJobsBtn">Manage jobs</button></div></div></section>
<section id="jobs" class="tab hidden"><div class="card"><div class="section-head"><div><h2 id="jobFormTitle">Create job</h2><p class="muted">Create a position, then manage it from the Jobs dashboard.</p></div><button class="btn secondary hidden" type="button" id="cancelJobEdit">Cancel edit</button></div><form id="jobForm"><input type="hidden" id="editingJobId"><div class="row"><input class="input" id="jobTitle" placeholder="Job title" required><input class="input" id="jobLocation" placeholder="Location"></div><input class="input" id="jobSalary" placeholder="Salary / range (optional)"><textarea class="input" id="jobDescription" rows="6" placeholder="Job description" required></textarea><input class="input" id="jobSkills" placeholder="Required skills, comma separated"><div class="form-actions"><button class="btn" id="jobSubmitBtn" type="submit">Create job</button><button class="btn secondary hidden" id="jobResetBtn" type="button">Clear form</button></div><p id="jobMsg" class="muted"></p></form></div><div class="card"><div class="section-head"><div><h2>Jobs</h2><p class="muted">Edit or remove positions without losing existing screening history.</p></div><button class="btn secondary" type="button" id="refreshJobs">Refresh</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Location</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody id="jobsBody"></tbody></table></div></div></section>
<section id="candidates" class="tab hidden"><div class="card"><h2>Upload CV</h2><p class="muted">Pilih satu atau banyak CV, atau satu folder. CV diproses satu per satu agar upload banyak file tidak macet. Nama, email, dan nomor HP tidak diperlukan.</p><form id="candidateForm"><div class="row"><select class="input" id="candidateJob" required><option value="">Select job position</option></select><div class="upload-options"><label class="upload-option"><span>📄 Upload file(s)</span><input class="input" id="candidateFiles" type="file" accept=".pdf,.docx,.txt" multiple></label><label class="upload-option"><span>📁 Upload folder</span><input class="input" id="candidateFolder" type="file" accept=".pdf,.docx,.txt" multiple webkitdirectory directory></label></div></div><button class="btn">Upload CVs</button><p id="candidateMsg" class="muted"></p></form></div><div class="card"><h2>Candidate Screening Pool</h2><table class="table"><thead><tr><th>CV</th><th>Job</th><th>Score</th><th>Status</th></tr></thead><tbody id="candidatesBody"></tbody></table></div></section>
<section id="applications" class="tab hidden"><div class="card"><h2>Screening pipeline</h2><table class="table"><thead><tr><th>Candidate</th><th>Job</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody id="appsBody"></tbody></table></div><div id="result" class="card hidden">
<style>
.ai-result-card{border:1px solid #dbe4f0;border-radius:18px;background:#fff;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.ai-result-head{padding:22px 24px;border-bottom:1px solid #e8edf5;display:flex;justify-content:space-between;align-items:center;gap:16px}
.ai-result-title{font-size:22px;font-weight:700;color:#0f2747;margin:0}.ai-result-sub{font-size:13px;color:#64748b;margin-top:5px}
.ai-status{padding:7px 12px;border-radius:999px;background:#eef4ff;color:#1459c7;font-size:13px;font-weight:700}
.ai-result-body{padding:22px 24px}.ai-score{font-size:42px;font-weight:800;color:#0f2747}.ai-score small{font-size:16px;color:#64748b}
.ai-note{padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#475569;font-size:13px;line-height:1.6}
.ai-grid{display:grid;grid-template-columns:160px 1fr;gap:20px;align-items:center}.ai-section{margin-top:22px}.ai-section h3{font-size:14px;color:#17365d;margin:0 0 10px}
.ai-chips{display:flex;flex-wrap:wrap;gap:8px}.ai-chip{padding:7px 10px;border:1px solid #dbe4f0;border-radius:999px;background:#f8fafc;color:#334155;font-size:13px}
.ai-error{border-color:#fecaca}.ai-error .ai-result-head{background:#fff7f7;border-bottom-color:#fee2e2}.ai-error .ai-result-title{color:#991b1b}
.ai-error-icon{width:38px;height:38px;border-radius:50%;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-weight:800}
.ai-error-box{padding:15px 16px;border:1px solid #fecaca;background:#fff7f7;border-radius:12px;color:#7f1d1d;font-size:13px;line-height:1.6}
.ai-error-code{display:inline-block;margin-top:9px;padding:4px 8px;border-radius:6px;background:#fee2e2;color:#991b1b;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:700px){.ai-grid{grid-template-columns:1fr}.ai-result-head{align-items:flex-start}}
</style>

<style>
.sc-pro{border:1px solid #d9e2ee;border-radius:16px;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.07);overflow:hidden}
.sc-pro-head{padding:24px 26px;border-bottom:1px solid #e7edf5;display:flex;justify-content:space-between;align-items:center;gap:20px}
.sc-kicker{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#64748b}
.sc-title{margin:7px 0 0;color:#102a43;font-size:24px;font-weight:750}.sc-sub{margin-top:5px;color:#64748b;font-size:13px}
.sc-score{min-width:130px;padding:14px 18px;border:1px solid #dbe5f0;border-radius:12px;text-align:center;background:#f8fafc}
.sc-score strong{font-size:34px;color:#0f2747}.sc-score span{color:#64748b;font-size:13px;font-weight:600}.sc-muted{color:#64748b;font-weight:500}.sc-empty{color:#94a3b8;font-size:12px}.sc-list{margin:0;padding-left:18px;color:#475569;font-size:12px;line-height:1.65}
.sc-body{padding:24px 26px}.sc-row{display:flex;align-items:center;gap:12px}.sc-status{display:inline-flex;padding:6px 11px;border-radius:999px;font-size:12px;font-weight:700;background:#eef4ff;color:#1459c7}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}.sc-panel{border:1px solid #e1e8f0;border-radius:12px;padding:16px;background:#fbfcfe}.sc-panel h3{margin:0 0 12px;font-size:13px;color:#183b61}.sc-chip{display:inline-block;padding:6px 9px;margin:0 6px 6px 0;border:1px solid #dbe4ee;border-radius:999px;background:#fff;color:#334155;font-size:12px}
.sc-break{margin-top:20px;border:1px solid #e1e8f0;border-radius:12px;overflow:hidden}.sc-break-title{padding:14px 16px;background:#f8fafc;border-bottom:1px solid #e5ebf2;font-size:14px;font-weight:700;color:#17365d}
.sc-criterion{display:grid;grid-template-columns:180px 1fr 70px;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid #edf1f5;font-size:13px}.sc-criterion:last-child{border-bottom:0}.sc-bar{height:7px;border-radius:99px;background:#e9eef5;overflow:hidden}.sc-bar i{display:block;height:100%;border-radius:99px;background:#1769e0}.sc-points{text-align:right;font-weight:700;color:#17365d}
.sc-note{margin-top:18px;padding:13px 15px;border-radius:10px;background:#f8fafc;border:1px solid #e1e8f0;color:#52657a;font-size:12px;line-height:1.55}
.sc-error{border-color:#fecaca}.sc-error .sc-pro-head{background:#fff7f7;border-bottom-color:#fee2e2}.sc-error .sc-title{color:#991b1b}.sc-errorbox{padding:16px;border:1px solid #fecaca;border-radius:10px;background:#fff7f7;color:#7f1d1d;font-size:13px;line-height:1.6}
@media(max-width:700px){.sc-pro-head{align-items:flex-start}.sc-grid{grid-template-columns:1fr}.sc-criterion{grid-template-columns:1fr}.sc-points{text-align:left}}
</style>
<script>
function scEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function scChips(v){const a=Array.isArray(v)?v:[];return a.length?a.map(x=>'<span class="sc-chip">'+scEsc(x)+'</span>').join(''):'<span style="color:#94a3b8;font-size:12px">No evidence identified</span>'}
function scCriterion(name,b,fixedMax){
 const s=typeof b==='number'?Number(b):Number(b?.score||0),m=fixedMax||Number(b?.max||0),pct=m?Math.max(0,Math.min(100,s/m*100)):0;
 return '<div class="sc-criterion"><strong>'+scEsc(name)+'</strong><div class="sc-bar"><i style="width:'+pct+'%"></i></div><div class="sc-points">'+s+' / '+m+'</div></div>';
}
function renderProfessionalScreeningResult(raw){
 const host=document.querySelector('#screening-result'); if(!host)return;
 let d=raw;if(typeof raw==='string'){try{d=JSON.parse(raw)}catch{d={error:raw}}}
 if(d&&d.error){
  const code=String(d.error),detail=String(d.detail||'');
  let title='AI screening temporarily unavailable',msg='The screening service could not complete this request.';
  if(code==='cv_not_extracted'){title='CV extraction required';msg='Extract the CV before running AI Screening.'}
  if(code==='ai_not_configured'){title='AI service not configured';msg='The AI provider is not configured for this workspace.'}
  if(code==='cv_extraction_failed'){title='CV extraction could not be completed';msg='The CV could not be processed. Check AI credits/quota and retry.'}
  host.innerHTML='<div class="sc-pro sc-error"><div class="sc-pro-head"><div><div class="sc-kicker">SCREENING STATUS</div><h2 class="sc-title">'+scEsc(title)+'</h2><div class="sc-sub">No candidate score was changed</div></div><div class="sc-score">!</div></div><div class="sc-body"><div class="sc-errorbox">'+scEsc(msg)+(detail?'<br><br><small>'+scEsc(detail)+'</small>':'')+'</div></div></div>';return;
 }
 const score=Number(d?.overall_score??d?.score??0),status=String(d?.status||'Screened');
 const b=d?.breakdown;
 const hasBreak=b&&typeof b==='object';
 const method=hasBreak?'Rule-based scoring':'AI model assessment';
 let breakdown=hasBreak?'<div class="sc-break"><div class="sc-break-title">Score breakdown · '+scEsc(method)+'</div>'+
 scCriterion('Skills match',b.skills_match)+scCriterion('Experience',b.experience)+scCriterion('Role relevance',b.role_relevance)+scCriterion('Profile completeness',b.profile_completeness)+'</div>':
 '<div class="sc-note"><strong>How the score is produced</strong><br>The AI assessment evaluates job-relevant skills, experience, role relevance, achievements and the evidence available in the CV against the selected job. The model returns a score from 0–100.</div>';
 const summary=String(d?.summary||d?.note||'Screening completed.').replace(/^Rule-based screening.*$/,'Rule-based screening based on job/CV evidence.');
 host.innerHTML='<div class="sc-pro"><div class="sc-pro-head"><div><div class="sc-kicker">AI SCREENING RESULT</div><h2 class="sc-title">Candidate assessment</h2><div class="sc-sub">'+scEsc(method)+'</div></div><div class="sc-score"><strong>'+scEsc(score)+'</strong><br><span>/ 100</span></div></div><div class="sc-body"><div class="sc-row"><span class="sc-status">'+scEsc(status)+'</span></div><div class="sc-grid"><div class="sc-panel"><h3>Matched evidence</h3>'+scChips(d?.matched_skills)+'</div><div class="sc-panel"><h3>Areas to review</h3>'+scChips(d?.missing_skills)+'</div></div>'+breakdown+'<div class="sc-note">'+scEsc(summary)+'</div></div></div>';
}
</script>
<h2>Screening result</h2><div id="resultText"></div></div></section>
</main></div>
<style>
.section-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}.section-head h2{margin-bottom:4px}.form-actions{display:flex;gap:8px;align-items:center;margin-top:12px}.table-wrap{overflow:auto}.job-actions{display:flex;gap:8px;flex-wrap:wrap}.job-action{white-space:nowrap;min-width:72px}.job-status{display:inline-flex;padding:5px 9px;border-radius:999px;background:#ecfdf3;color:#047857;font-size:12px;font-weight:750;text-transform:capitalize}.job-status.closed{background:#f1f5f9;color:#64748b}.job-empty{text-align:center;color:#64748b;padding:34px}.job-empty strong{color:#17365d;font-size:14px}.job-empty span{display:inline-block;margin-top:4px;font-size:12px}.job-danger{color:#b91c1c!important;border-color:#fecaca!important;background:#fff7f7!important}.job-danger:hover{background:#fee2e2!important}.job-title-cell{display:flex;flex-direction:column;gap:4px}.job-title-cell strong{color:#102a43;font-size:14px}.job-title-cell span{font-size:11px;color:#94a3b8}.screen-loading{display:flex;align-items:center;gap:12px;padding:18px;border:1px solid #dbe5f0;background:#f8fafc;border-radius:12px;color:#334155}.screen-loading strong{display:block}.screen-loading small{display:block;color:#64748b;margin-top:3px}.loader-dot{width:12px;height:12px;border-radius:50%;border:2px solid #bfdbfe;border-top-color:#1769e0;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:700px){.section-head{align-items:flex-start;flex-direction:column}.job-actions{flex-direction:row;align-items:stretch}.job-action{width:auto}}</style>
<script src="/app.js?v=633" defer></script></body></html>`));

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
