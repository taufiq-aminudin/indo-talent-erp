const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"no-store",...extra}
});
const withSecurity=(response)=>{
 const h=new Headers(response.headers);
 h.set("X-Content-Type-Options","nosniff");
 h.set("X-Frame-Options","DENY");
 h.set("Referrer-Policy","strict-origin-when-cross-origin");
 h.set("Permissions-Policy","camera=(),microphone=(),geolocation=()");
 h.set("Access-Control-Allow-Origin","*");
 h.set("Access-Control-Allow-Headers","Content-Type, Authorization");
 h.set("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS");
 return new Response(response.body,{status:response.status,headers:h});
};
const uid=()=>crypto.randomUUID();

async function hashPassword(password){
 const enc=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:120000,hash:"SHA-256"},key,256);
 return `${btoa(String.fromCharCode(...salt))}.${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function verifyPassword(password,stored){
 try{
  const [s,h]=stored.split(".");
  const salt=Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:120000,hash:"SHA-256"},key,256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)))===h;
 }catch{return false}
}
function tokenOf(request){const h=request.headers.get("Authorization")||"";return h.startsWith("Bearer ")?h.slice(7):""}
async function currentUser(request,env){
 const t=tokenOf(request); if(!t)return null;
 return await env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.phone,u.company_name
 FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.token=? AND s.expires_at>? AND u.is_active=1`).bind(t,Date.now()).first();
}
async function guard(request,env,roles=[]){
 const user=await currentUser(request,env);
 if(!user)return {error:json({success:false,error:"Unauthorized"},401)};
 if(roles.length&&!roles.includes(user.role))return {error:json({success:false,error:"Forbidden"},403)};
 return {user};
}
async function audit(env,actor,action,type,id,details=""){
 await env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?,?)")
 .bind(uid(),actor,action,type,id,details).run();
}
async function seed(env){
 const row=await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
 if(row?.c)return;
 for(const [email,name,role,pw,company] of [
  ["admin@indo-talent.my.id","Indo-Talent Admin","admin","Admin123!",""],
  ["company@indo-talent.my.id","Demo Company","company","Company123!","Demo Company"],
  ["candidate@indo-talent.my.id","Demo Candidate","candidate","Candidate123!",""]
 ]){
  const id=uid();
  await env.DB.prepare("INSERT INTO users(id,name,email,password_hash,role,company_name) VALUES(?,?,?,?,?,?)")
   .bind(id,name,email,await hashPassword(pw),role,company).run();
  await env.DB.prepare("INSERT INTO profiles(user_id) VALUES(?)").bind(id).run();
 }
 const c=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind("company@indo-talent.my.id").first();
 await env.DB.prepare(`INSERT INTO jobs(id,company_id,title,location,employment_type,workplace_type,salary_min,salary_max,description,requirements)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid(),c.id,"Human Resources Manager","Jakarta, Indonesia","Full Time","On-site",25000000,40000000,
 "Lead HR strategy, talent acquisition, employee relations and compliance.",
 "3–5 years HR management experience; strong labor law and talent management knowledge; Mandarin preferred.").run();
}

async function api(request,env){
 await seed(env);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api/,"")||"/",method=request.method;
 if(method==="OPTIONS")return new Response(null,{status:204});

 if(method==="GET"&&path==="/health")return json({success:true,service:"indo-talent-erp",version:"2.0"});

 if(method==="POST"&&path==="/auth/register"){
  const b=await request.json(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
  const role=["candidate","company"].includes(b.role)?b.role:"candidate";
  if(!b.name||!email||password.length<8)return json({success:false,error:"Nama, email dan password minimal 8 karakter wajib diisi."},400);
  if(await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first())return json({success:false,error:"Email sudah terdaftar."},409);
  const id=uid();
  await env.DB.prepare("INSERT INTO users(id,name,email,password_hash,role,phone,company_name) VALUES(?,?,?,?,?,?,?)")
   .bind(id,b.name,email,await hashPassword(password),role,b.phone||"",role==="company"?(b.company_name||b.name):"").run();
  await env.DB.prepare("INSERT INTO profiles(user_id) VALUES(?)").bind(id).run();
  return json({success:true,message:"Registrasi berhasil. Silakan login."});
 }

 if(method==="POST"&&path==="/auth/login"){
  const b=await request.json(),email=String(b.email||"").trim().toLowerCase();
  const user=await env.DB.prepare("SELECT * FROM users WHERE email=? AND is_active=1").bind(email).first();
  if(!user||!(await verifyPassword(String(b.password||""),user.password_hash)))return json({success:false,error:"Email atau password salah."},401);
  const token=crypto.randomUUID()+"."+crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)").bind(token,user.id,Date.now()+604800000).run();
  await audit(env,user.id,"login","user",user.id);
  return json({success:true,token,user:{id:user.id,name:user.name,email:user.email,role:user.role,company_name:user.company_name}});
 }

 if(method==="POST"&&path==="/auth/logout"){
  const t=tokenOf(request);if(t)await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(t).run();
  return json({success:true});
 }

 if(method==="GET"&&path==="/jobs"){
  const rows=await env.DB.prepare(`SELECT j.*,u.company_name FROM jobs j JOIN users u ON u.id=j.company_id
   WHERE j.status='published' AND u.is_active=1 ORDER BY j.created_at DESC`).all();
  return json({success:true,jobs:rows.results||[]});
 }

 if(method==="GET"&&path.startsWith("/jobs/")){
  const id=path.split("/")[2];
  const row=await env.DB.prepare(`SELECT j.*,u.company_name FROM jobs j JOIN users u ON u.id=j.company_id WHERE j.id=?`).bind(id).first();
  return row?json({success:true,job:row}):json({success:false,error:"Job tidak ditemukan"},404);
 }

 if(method==="GET"&&path==="/me"){
  const g=await guard(request,env);if(g.error)return g.error;
  const p=await env.DB.prepare("SELECT * FROM profiles WHERE user_id=?").bind(g.user.id).first();
  return json({success:true,user:g.user,profile:p||{}});
 }

 if(method==="PUT"&&path==="/me"){
  const g=await guard(request,env);if(g.error)return g.error;const b=await request.json();
  await env.DB.prepare("UPDATE users SET name=?,phone=?,company_name=? WHERE id=?")
   .bind(b.name||g.user.name,b.phone||"",b.company_name||g.user.company_name||"",g.user.id).run();
  await env.DB.prepare(`INSERT INTO profiles(user_id,headline,education,experience,skills,cv_url,website)
   VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET headline=excluded.headline,education=excluded.education,
   experience=excluded.experience,skills=excluded.skills,cv_url=excluded.cv_url,website=excluded.website`)
   .bind(g.user.id,b.headline||"",b.education||"",b.experience||"",b.skills||"",b.cv_url||"",b.website||"").run();
  await audit(env,g.user.id,"update","profile",g.user.id);
  return json({success:true});
 }

 if(method==="POST"&&path.match(/^\/jobs\/[^/]+\/apply$/)){
  const g=await guard(request,env,["candidate"]);if(g.error)return g.error;
  const jobId=path.split("/")[2],b=await request.json();
  const job=await env.DB.prepare("SELECT id,company_id,title FROM jobs WHERE id=? AND status='published'").bind(jobId).first();
  if(!job)return json({success:false,error:"Lowongan tidak ditemukan."},404);
  try{
   const appId=uid();
   await env.DB.prepare("INSERT INTO applications(id,job_id,candidate_id,cover_letter) VALUES(?,?,?,?)")
    .bind(appId,jobId,g.user.id,b.cover_letter||"").run();
   await env.DB.prepare("INSERT INTO notifications(id,user_id,title,message) VALUES(?,?,?,?)")
    .bind(uid(),job.company_id,"Lamaran baru",`${g.user.name} melamar ${job.title}`).run();
   await audit(env,g.user.id,"create","application",appId,job.title);
   return json({success:true,message:"Lamaran berhasil dikirim."});
  }catch{return json({success:false,error:"Anda sudah melamar lowongan ini."},409)}
 }

 if(method==="GET"&&path==="/applications"){
  const g=await guard(request,env);if(g.error)return g.error;let rows;
  if(g.user.role==="candidate")rows=await env.DB.prepare(`SELECT a.*,j.title,j.location,u.company_name FROM applications a
    JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=j.company_id WHERE a.candidate_id=? ORDER BY a.created_at DESC`).bind(g.user.id).all();
  else if(g.user.role==="company")rows=await env.DB.prepare(`SELECT a.*,j.title,j.location,c.name candidate_name,c.email candidate_email,u.company_name
    FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users c ON c.id=a.candidate_id JOIN users u ON u.id=j.company_id
    WHERE j.company_id=? ORDER BY a.created_at DESC`).bind(g.user.id).all();
  else rows=await env.DB.prepare(`SELECT a.*,j.title,j.location,c.name candidate_name,c.email candidate_email,u.company_name
    FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users c ON c.id=a.candidate_id JOIN users u ON u.id=j.company_id
    ORDER BY a.created_at DESC`).all();
  return json({success:true,applications:rows.results||[]});
 }

 if(method==="PUT"&&path.match(/^\/applications\/[^/]+$/)){
  const g=await guard(request,env,["company","admin"]);if(g.error)return g.error;
  const id=path.split("/")[2],b=await request.json();
  const allowed=["Applied","Screening","Shortlisted","Interview","Test","Offer","Hired","Rejected"];
  if(!allowed.includes(b.status))return json({success:false,error:"Status tidak valid."},400);
  const app=await env.DB.prepare(`SELECT a.id,j.company_id,a.candidate_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=?`).bind(id).first();
  if(!app)return json({success:false,error:"Application tidak ditemukan."},404);
  if(g.user.role==="company"&&app.company_id!==g.user.id)return json({success:false,error:"Tidak berwenang."},403);
  await env.DB.prepare("UPDATE applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.status,id).run();
  await env.DB.prepare("INSERT INTO notifications(id,user_id,title,message) VALUES(?,?,?,?)")
   .bind(uid(),app.candidate_id,"Application update",`Status lamaran Anda berubah menjadi ${b.status}.`).run();
  await audit(env,g.user.id,"update","application",id,b.status);
  return json({success:true});
 }

 if(method==="POST"&&path==="/jobs"){
  const g=await guard(request,env,["company","admin"]);if(g.error)return g.error;const b=await request.json();
  if(!b.title)return json({success:false,error:"Judul lowongan wajib diisi."},400);
  const companyId=g.user.role==="admin"?(b.company_id||g.user.id):g.user.id;
  if(g.user.role==="admin"&&b.company_id&&!await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='company'").bind(b.company_id).first())
    return json({success:false,error:"Company tidak valid."},400);
  const id=uid();
  await env.DB.prepare(`INSERT INTO jobs(id,company_id,title,location,employment_type,workplace_type,salary_min,salary_max,currency,description,requirements,benefits,status)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,companyId,b.title,b.location||"",b.employment_type||"Full Time",b.workplace_type||"On-site",
   Number(b.salary_min||0),Number(b.salary_max||0),"IDR",b.description||"",b.requirements||"",b.benefits||"",b.status||"published").run();
  await audit(env,g.user.id,"create","job",id,b.title);
  return json({success:true,id});
 }

 if(method==="GET"&&path==="/company/jobs"){
  const g=await guard(request,env,["company","admin"]);if(g.error)return g.error;
  const rows=g.user.role==="admin"?await env.DB.prepare(`SELECT j.*,u.company_name FROM jobs j JOIN users u ON u.id=j.company_id ORDER BY j.created_at DESC`).all()
   :await env.DB.prepare("SELECT * FROM jobs WHERE company_id=? ORDER BY created_at DESC").bind(g.user.id).all();
  return json({success:true,jobs:rows.results||[]});
 }

 if(method==="GET"&&path==="/admin/stats"){
  const g=await guard(request,env,["admin"]);if(g.error)return g.error;
  const q=async s=>(await env.DB.prepare(s).first())?.c||0;
  return json({success:true,stats:{users:await q("SELECT COUNT(*) c FROM users"),companies:await q("SELECT COUNT(*) c FROM users WHERE role='company'"),
   candidates:await q("SELECT COUNT(*) c FROM users WHERE role='candidate'"),jobs:await q("SELECT COUNT(*) c FROM jobs"),
   applications:await q("SELECT COUNT(*) c FROM applications"),hired:await q("SELECT COUNT(*) c FROM applications WHERE status='Hired'")}});
 }

 return json({success:false,error:"Endpoint tidak ditemukan"},404);
}

export default {async fetch(request,env){
 try{
  const u=new URL(request.url);
  const response=u.pathname.startsWith("/api/")?await api(request,env):await env.ASSETS.fetch(request);
  return withSecurity(response);
 }catch(e){return withSecurity(json({success:false,error:"Server error",detail:String(e)},500))}
}};
