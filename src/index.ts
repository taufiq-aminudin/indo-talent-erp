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

type AuthUser = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: string;
  organization_name: string;
};

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

app.use("*", secureHeaders());
app.use("/api/*", cors({
  origin: (origin) => origin || "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}

async function passwordHash(password: string) {
  const iterations = 120_000;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

async function passwordVerify(password: string, stored: string) {
  const [scheme, iterationText, saltText, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationText || !saltText || !expected) return false;
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 50_000 || iterations > 500_000) return false;
  const saltB64 = saltText.replace(/-/g, "+").replace(/_/g, "/");
  const saltBin = atob(saltB64 + "=".repeat((4 - (saltB64.length % 4)) % 4));
  const salt = Uint8Array.from(saltBin, (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return b64url(new Uint8Array(bits)) === expected;
}

function cookieToken(req: Request) {
  const cookie = req.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match?.[1] || null;
}

function setSessionCookie(token: string, maxAge: number) {
  return `session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(c: any, user: AuthUser) {
  const token = new Uint8Array(32);
  crypto.getRandomValues(token);
  const raw = b64url(token);
  const tokenHash = await sha256(raw);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO sessions(id,user_id,organization_id,expires_at) VALUES(?,?,?,?)",
  ).bind(tokenHash, user.id, user.organization_id, expires).run();
  c.header("Set-Cookie", setSessionCookie(raw, 7 * 24 * 60 * 60));
}

async function currentUser(c: any): Promise<AuthUser | null> {
  const raw = cookieToken(c.req.raw);
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const row = await c.env.DB.prepare(
    `SELECT u.id,u.organization_id,u.name,u.email,u.role,o.name AS organization_name
     FROM sessions s JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=s.organization_id
     WHERE s.id=? AND s.expires_at > CURRENT_TIMESTAMP LIMIT 1`,
  ).bind(tokenHash).first<AuthUser>();
  return row || null;
}

async function requireAuth(c: any, next: any) {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
}

async function audit(c: any, user: AuthUser, action: string, entityType?: string, entityId?: string, metadata?: unknown) {
  await c.env.DB.prepare(
    "INSERT INTO audit_logs(id,organization_id,user_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)",
  ).bind(id(), user.organization_id, user.id, action, entityType || null, entityId || null, metadata ? JSON.stringify(metadata) : null).run();
}

app.get("/api/health", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ ok: row?.ok === 1, app: c.env.APP_NAME, runtime: "cloudflare-workers", database: "d1", storage: "r2", version: "v6.1-auth-tenant" });
  } catch {
    return c.json({ ok: false, app: c.env.APP_NAME, error: "database_unavailable" }, 503);
  }
});

app.post("/api/auth/register", async (c) => {
  const body = await c.req.json<{ organization_name: string; name: string; email: string; password: string }>();
  const organizationName = body.organization_name?.trim();
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  if (!organizationName || !name || !email || password.length < 10) {
    return c.json({ error: "organization_name,name,email,password_min_10_required" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email=? LIMIT 1").bind(email).first();
  if (existing) return c.json({ error: "email_already_registered" }, 409);

  const orgId = id();
  const userId = id();
  const slug = `${organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org"}-${crypto.randomUUID().slice(0, 8)}`;
  const hash = await passwordHash(password);

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO organizations(id,name,slug) VALUES(?,?,?)").bind(orgId, organizationName, slug),
    c.env.DB.prepare("INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?)").bind(userId, orgId, name, email, hash, "admin"),
  ]);

  const user: AuthUser = { id: userId, organization_id: orgId, name, email, role: "admin", organization_name: organizationName };
  await createSession(c, user);
  await audit(c, user, "auth.register", "organization", orgId);
  return c.json({ user }, 201);
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return c.json({ error: "email,password_required" }, 400);

  const row = await c.env.DB.prepare(
    `SELECT u.id,u.organization_id,u.name,u.email,u.password_hash,u.role,o.name AS organization_name
     FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.email=? LIMIT 1`,
  ).bind(email).first<any>();
  if (!row || !(await passwordVerify(password, row.password_hash))) return c.json({ error: "invalid_credentials" }, 401);

  const user: AuthUser = { id: row.id, organization_id: row.organization_id, name: row.name, email: row.email, role: row.role, organization_name: row.organization_name };
  await createSession(c, user);
  await audit(c, user, "auth.login", "user", user.id);
  return c.json({ user });
});

app.post("/api/auth/logout", async (c) => {
  const raw = cookieToken(c.req.raw);
  if (raw) await c.env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(await sha256(raw)).run();
  c.header("Set-Cookie", setSessionCookie("", 0));
  return c.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (c) => c.json({ user: c.get("user") }));

app.use("/api/jobs", requireAuth);
app.use("/api/candidates", requireAuth);
app.use("/api/applications", requireAuth);
app.use("/api/dashboard", requireAuth);
app.use("/api/screenings/*", requireAuth);

app.get("/api/dashboard", async (c) => {
  const user = c.get("user");
  const [jobs, candidates, applications, strong] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE organization_id=?").bind(user.organization_id).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM candidates WHERE organization_id=?").bind(user.organization_id).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM applications WHERE organization_id=?").bind(user.organization_id).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM applications WHERE organization_id=? AND score>=85").bind(user.organization_id).first<{ count: number }>(),
  ]);
  return c.json({ jobs: jobs?.count || 0, candidates: candidates?.count || 0, applications: applications?.count || 0, strong_matches: strong?.count || 0 });
});

app.get("/api/jobs", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    "SELECT id,title,location,description,requirements_json,created_at FROM jobs WHERE organization_id=? ORDER BY created_at DESC",
  ).bind(user.organization_id).all();
  return c.json(result.results);
});

app.post("/api/jobs", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ title: string; location?: string; description: string; requirements?: string[] }>();
  if (!body.title?.trim() || !body.description?.trim()) return c.json({ error: "title,description_required" }, 400);
  const jobId = id();
  await c.env.DB.prepare(
    "INSERT INTO jobs(id,organization_id,title,location,description,requirements_json,created_by) VALUES(?,?,?,?,?,?,?)",
  ).bind(jobId, user.organization_id, body.title.trim(), body.location?.trim() || "", body.description.trim(), JSON.stringify(body.requirements || []), user.id).run();
  await audit(c, user, "job.create", "job", jobId);
  return c.json({ id: jobId }, 201);
});

app.get("/api/candidates", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `SELECT id,name,email,phone,cv_object_key,cv_filename,created_at
     FROM candidates WHERE organization_id=? ORDER BY created_at DESC`,
  ).bind(user.organization_id).all();
  return c.json(result.results);
});

app.post("/api/candidates", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name: string; email?: string; phone?: string; cv_text?: string; cv_filename?: string; job_id?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name_required" }, 400);
  const candidateId = id();
  await c.env.DB.prepare(
    "INSERT INTO candidates(id,organization_id,name,email,phone,cv_text,cv_filename) VALUES(?,?,?,?,?,?,?)",
  ).bind(candidateId, user.organization_id, body.name.trim(), body.email?.trim() || "", body.phone?.trim() || "", body.cv_text || "", body.cv_filename || "").run();

  if (body.job_id) {
    const job = await c.env.DB.prepare("SELECT id FROM jobs WHERE id=? AND organization_id=?").bind(body.job_id, user.organization_id).first();
    if (job) await c.env.DB.prepare("INSERT OR IGNORE INTO applications(id,organization_id,job_id,candidate_id) VALUES(?,?,?,?)").bind(id(), user.organization_id, body.job_id, candidateId).run();
  }
  await audit(c, user, "candidate.create", "candidate", candidateId);
  return c.json({ id: candidateId }, 201);
});

app.post("/api/candidates/upload", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const jobId = String(form.get("job_id") || "").trim();
  if (!(file instanceof File) || !name) return c.json({ error: "file,name_required" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "file_too_large_max_10mb" }, 413);
  const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
  if (!allowed.includes(file.type)) return c.json({ error: "unsupported_file_type", allowed }, 415);

  const candidateId = id();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "cv";
  const key = `${user.organization_id}/candidates/${candidateId}/${safeName}`;
  await c.env.CV_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  let cvText = "";
  if (file.type === "text/plain") cvText = (await file.text()).slice(0, 100_000);
  await c.env.DB.prepare(
    `INSERT INTO candidates(id,organization_id,name,email,phone,cv_object_key,cv_filename,cv_text)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).bind(candidateId, user.organization_id, name, email, phone, key, file.name, cvText).run();

  if (jobId) {
    const job = await c.env.DB.prepare("SELECT id FROM jobs WHERE id=? AND organization_id=?").bind(jobId, user.organization_id).first();
    if (job) await c.env.DB.prepare("INSERT OR IGNORE INTO applications(id,organization_id,job_id,candidate_id) VALUES(?,?,?,?)").bind(id(), user.organization_id, jobId, candidateId).run();
  }
  await audit(c, user, "candidate.upload", "candidate", candidateId, { filename: file.name, size: file.size, mime: file.type });
  return c.json({ id: candidateId, object_key: key, filename: file.name, extraction_status: file.type === "text/plain" ? "complete" : "pending" }, 201);
});

app.get("/api/applications", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `SELECT a.id,a.status,a.score,a.analysis_json,a.created_at,
            j.id AS job_id,j.title AS job_title,
            c.id AS candidate_id,c.name AS candidate_name,c.email AS candidate_email,c.cv_filename
     FROM applications a
     JOIN jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
     JOIN candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id
     WHERE a.organization_id=? ORDER BY a.created_at DESC`,
  ).bind(user.organization_id).all();
  return c.json(result.results);
});

app.post("/api/applications", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ job_id: string; candidate_id: string }>();
  const job = await c.env.DB.prepare("SELECT id FROM jobs WHERE id=? AND organization_id=?").bind(body.job_id, user.organization_id).first();
  const candidate = await c.env.DB.prepare("SELECT id FROM candidates WHERE id=? AND organization_id=?").bind(body.candidate_id, user.organization_id).first();
  if (!job || !candidate) return c.json({ error: "job_or_candidate_not_found" }, 404);
  const applicationId = id();
  try {
    await c.env.DB.prepare("INSERT INTO applications(id,organization_id,job_id,candidate_id) VALUES(?,?,?,?)").bind(applicationId, user.organization_id, body.job_id, body.candidate_id).run();
  } catch {
    return c.json({ error: "application_already_exists" }, 409);
  }
  await audit(c, user, "application.create", "application", applicationId);
  return c.json({ id: applicationId }, 201);
});

app.post("/api/screenings/rule", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ application_id: string; required_skills?: string[]; min_years?: number }>();
  const row = await c.env.DB.prepare(
    `SELECT a.id,a.job_id,a.candidate_id,j.title,j.description,j.requirements_json,c.cv_text
     FROM applications a JOIN jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
     JOIN candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id
     WHERE a.id=? AND a.organization_id=? LIMIT 1`,
  ).bind(body.application_id, user.organization_id).first<any>();
  if (!row) return c.json({ error: "application_not_found" }, 404);
  const text = String(row.cv_text || "").toLowerCase();
  let skills: string[] = body.required_skills || [];
  if (!skills.length) {
    try { skills = JSON.parse(row.requirements_json || "[]"); } catch { skills = []; }
  }
  const hits = skills.filter((s) => text.includes(String(s).toLowerCase()));
  const technical = skills.length ? Math.round((hits.length / skills.length) * 100) : 100;
  const yearMatches = [...text.matchAll(/(\d+)\+?\s*(years?|tahun)/g)].map((m) => Number(m[1]));
  const minYears = body.min_years || 0;
  const experience = !minYears ? 100 : Math.min(100, Math.round((Math.max(0, ...yearMatches) / minYears) * 100));
  const score = Math.round(experience * 0.5 + technical * 0.5);
  const result = { overall_score: score, status: score >= 85 ? "Strong Match" : score >= 70 ? "Potential Match" : "Low Match", matched_skills: hits, missing_skills: skills.filter((s) => !hits.includes(s)), note: "Rule-based screening. Recruiter review remains required." };
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE applications SET score=?,status=?,analysis_json=? WHERE id=? AND organization_id=?").bind(score, result.status, JSON.stringify(result), body.application_id, user.organization_id),
    c.env.DB.prepare("INSERT INTO screenings(id,organization_id,application_id,type,score,result_json) VALUES(?,?,?,?,?,?)").bind(id(), user.organization_id, body.application_id, "rule", score, JSON.stringify(result)),
  ]);
  await audit(c, user, "screening.rule", "application", body.application_id, { score });
  return c.json(result);
});

app.post("/api/ai/screen", async (c) => {
  const user = c.get("user");
  if (!c.env.OPENAI_API_KEY) return c.json({ error: "ai_not_configured", message: "Set OPENAI_API_KEY as a Worker secret." }, 503);
  const body = await c.req.json<{ application_id: string }>();
  const row = await c.env.DB.prepare(
    `SELECT a.id,j.title,j.description,c.name,c.cv_text
     FROM applications a JOIN jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id
     JOIN candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id
     WHERE a.id=? AND a.organization_id=? LIMIT 1`,
  ).bind(body.application_id, user.organization_id).first<any>();
  if (!row) return c.json({ error: "application_not_found" }, 404);
  if (!row.cv_text) return c.json({ error: "cv_text_unavailable", message: "Extract CV text before AI screening." }, 422);

  const model = c.env.OPENAI_MODEL || "gpt-5.6";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      overall_score: { type: "integer", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      gaps: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
      recommendation: { type: "string" },
      interview_questions: { type: "array", items: { type: "string" } },
    },
    required: ["overall_score", "summary", "strengths", "gaps", "evidence", "recommendation", "interview_questions"],
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "Assess job fit using only job-relevant evidence. Never infer protected traits. Return structured JSON only. A recruiter must make the final decision.",
      input: `JOB TITLE: ${row.title}\nJOB DESCRIPTION: ${String(row.description).slice(0, 14000)}\nCANDIDATE NAME: ${row.name}\nCANDIDATE CV: ${String(row.cv_text).slice(0, 18000)}`,
      text: { format: { type: "json_schema", name: "candidate_screening", strict: true, schema } },
    }),
  });
  if (!response.ok) return c.json({ error: "ai_request_failed", status: response.status }, 502);
  const data = await response.json() as any;
  const content = data?.output?.flatMap((item: any) => item?.content || []).find((x: any) => x?.type === "output_text")?.text;
  if (!content) return c.json({ error: "empty_ai_response" }, 502);
  let result: any;
  try { result = JSON.parse(content); } catch { return c.json({ error: "invalid_ai_json" }, 502); }
  const status = result.overall_score >= 85 ? "Strong Match" : result.overall_score >= 70 ? "Potential Match" : "Low Match";
  result.status = status;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE applications SET score=?,status=?,analysis_json=? WHERE id=? AND organization_id=?").bind(result.overall_score, status, JSON.stringify(result), body.application_id, user.organization_id),
    c.env.DB.prepare("INSERT INTO screenings(id,organization_id,application_id,type,score,result_json) VALUES(?,?,?,?,?,?)").bind(id(), user.organization_id, body.application_id, "ai", result.overall_score, JSON.stringify(result)),
  ]);
  await audit(c, user, "screening.ai", "application", body.application_id, { score: result.overall_score, model });
  return c.json(result);
});

app.get("/", (c) => c.html(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.env.APP_NAME}</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;color:#10213b;background:#f6f8fb}body{margin:0}header{background:#fff;border-bottom:1px solid #e5eaf2;padding:18px 28px;display:flex;justify-content:space-between;align-items:center}main{max-width:1180px;margin:28px auto;padding:0 20px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px}.brand img{width:42px;height:42px;object-fit:contain}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#fff;border:1px solid #e4e9f1;border-radius:16px;padding:20px;box-shadow:0 3px 14px #132b4a0a;margin-bottom:18px}.metric b{font-size:30px;display:block;margin-top:8px}.tabs{display:flex;gap:8px;margin:18px 0}.tabs button,.btn{border:0;border-radius:10px;padding:10px 14px;background:#0b66ff;color:white;cursor:pointer}.tabs button.secondary,.btn.secondary{background:#edf2f8;color:#20304a}.hidden{display:none}.auth{max-width:480px;margin:60px auto}.input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d7deea;border-radius:10px;margin:6px 0 12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:11px;border-bottom:1px solid #edf0f5}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#edf4ff}.danger{color:#b42318}.logo{max-width:58px;max-height:58px}@media(max-width:800px){.grid,.row{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}}
</style></head><body>
<div id="auth" class="auth card"><div class="brand"><img src="/logo.png" onerror="this.style.display='none'"><span>${c.env.APP_NAME}</span></div><h2 id="authTitle">Sign in</h2><p class="muted">Secure recruiter workspace with tenant isolation.</p><form id="authForm"><div id="orgField" class="hidden"><label>Organization</label><input class="input" id="org" autocomplete="organization"></div><label>Name</label><input class="input" id="name" autocomplete="name"><label>Email</label><input class="input" id="email" type="email" autocomplete="email" required><label>Password</label><input class="input" id="password" type="password" minlength="10" autocomplete="current-password" required><button class="btn" id="authBtn">Sign in</button></form><p><button class="btn secondary" id="toggleAuth">Create an organization</button></p><div id="authMsg" class="muted"></div></div>
<div id="app" class="hidden"><header><div class="brand"><img src="/logo.png" onerror="this.style.display='none'"><span>${c.env.APP_NAME}</span></div><div><span id="who" class="muted"></span> <button class="btn secondary" id="logout">Logout</button></div></header><main><div class="tabs"><button data-tab="overview">Overview</button><button class="secondary" data-tab="jobs">Jobs</button><button class="secondary" data-tab="candidates">Candidates</button><button class="secondary" data-tab="applications">Screening</button></div>
<section id="overview" class="tab"><div class="grid"><div class="card metric">Jobs<b id="mJobs">0</b></div><div class="card metric">Candidates<b id="mCandidates">0</b></div><div class="card metric">Applications<b id="mApplications">0</b></div><div class="card metric">Strong matches<b id="mStrong">0</b></div></div><div class="card"><h2>AI Screening</h2><p class="muted">Create jobs, upload CVs, attach candidates to jobs, then run rule-based or AI screening.</p></div></section>
<section id="jobs" class="tab hidden"><div class="card"><h2>Create job</h2><form id="jobForm"><div class="row"><input class="input" id="jobTitle" placeholder="Job title" required><input class="input" id="jobLocation" placeholder="Location"></div><textarea class="input" id="jobDescription" rows="6" placeholder="Job description" required></textarea><input class="input" id="jobSkills" placeholder="Skills, comma separated"><button class="btn">Create job</button></form></div><div class="card"><h2>Jobs</h2><table class="table"><thead><tr><th>Title</th><th>Location</th><th>Created</th></tr></thead><tbody id="jobsBody"></tbody></table></div></section>
<section id="candidates" class="tab hidden"><div class="card"><h2>Upload CV</h2><form id="candidateForm"><div class="row"><input class="input" id="candidateName" placeholder="Candidate name" required><input class="input" id="candidateEmail" placeholder="Email"></div><div class="row"><input class="input" id="candidatePhone" placeholder="Phone"><select class="input" id="candidateJob"><option value="">Attach to job (optional)</option></select></div><input class="input" id="candidateFile" type="file" accept=".pdf,.docx,.txt" required><button class="btn">Upload candidate</button><p id="candidateMsg" class="muted"></p></form></div><div class="card"><h2>Candidates</h2><table class="table"><thead><tr><th>Name</th><th>Email</th><th>CV</th></tr></thead><tbody id="candidatesBody"></tbody></table></div></section>
<section id="applications" class="tab hidden"><div class="card"><h2>Screening pipeline</h2><table class="table"><thead><tr><th>Candidate</th><th>Job</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody id="appsBody"></tbody></table></div><div id="result" class="card hidden"><h2>Screening result</h2><pre id="resultText" style="white-space:pre-wrap"></pre></div></section>
</main></div>
<script>
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
let registerMode=false;
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',...opt});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'request_failed');return data}
function setMode(){registerMode=!registerMode;$('#authTitle').textContent=registerMode?'Create organization':'Sign in';$('#authBtn').textContent=registerMode?'Create account':'Sign in';$('#orgField').classList.toggle('hidden',!registerMode);$('#name').required=registerMode;$('#toggleAuth').textContent=registerMode?'Back to sign in':'Create an organization'}
$('#toggleAuth').onclick=e=>{e.preventDefault();setMode()};
$('#authForm').onsubmit=async e=>{e.preventDefault();$('#authMsg').textContent='Working...';try{const path=registerMode?'/api/auth/register':'/api/auth/login';const body=registerMode?{organization_name:$('#org').value,name:$('#name').value,email:$('#email').value,password:$('#password').value}:{email:$('#email').value,password:$('#password').value};await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await boot()}catch(err){$('#authMsg').textContent=err.message}}
$('#logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});location.reload()};
$$('.tabs button').forEach(b=>b.onclick=()=>{$$('.tabs button').forEach(x=>x.classList.add('secondary'));b.classList.remove('secondary');$$('.tab').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.tab).classList.remove('hidden');if(b.dataset.tab==='jobs')loadJobs();if(b.dataset.tab==='candidates')loadCandidates();if(b.dataset.tab==='applications')loadApps()});
async function loadJobs(){const jobs=await api('/api/jobs');$('#jobsBody').innerHTML=jobs.map(j=>\`<tr><td>\${esc(j.title)}</td><td>\${esc(j.location||'-')}</td><td>\${new Date(j.created_at).toLocaleString()}</td></tr>\`).join('');$('#candidateJob').innerHTML='<option value="">Attach to job (optional)</option>'+jobs.map(j=>\`<option value="\${j.id}">\${esc(j.title)}</option>\`).join('')}
async function loadCandidates(){const rows=await api('/api/candidates');$('#candidatesBody').innerHTML=rows.map(x=>\`<tr><td>\${esc(x.name)}</td><td>\${esc(x.email||'-')}</td><td>\${esc(x.cv_filename||'-')}</td></tr>\`).join('')}
async function loadApps(){const rows=await api('/api/applications');$('#appsBody').innerHTML=rows.map(x=>\`<tr><td>\${esc(x.candidate_name)}</td><td>\${esc(x.job_title)}</td><td>\${x.score||0}</td><td><span class="pill">\${esc(x.status)}</span></td><td><button class="btn secondary" onclick="rule('\${x.id}')">Rule</button> <button class="btn" onclick="ai('\${x.id}')">AI</button></td></tr>\`).join('')}
async function refresh(){const d=await api('/api/dashboard');$('#mJobs').textContent=d.jobs;$('#mCandidates').textContent=d.candidates;$('#mApplications').textContent=d.applications;$('#mStrong').textContent=d.strong_matches;await loadJobs()}
$('#jobForm').onsubmit=async e=>{e.preventDefault();await api('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:$('#jobTitle').value,location:$('#jobLocation').value,description:$('#jobDescription').value,requirements:$('#jobSkills').value.split(',').map(x=>x.trim()).filter(Boolean)})});e.target.reset();await refresh();loadJobs()}
$('#candidateForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData();fd.append('name',$('#candidateName').value);fd.append('email',$('#candidateEmail').value);fd.append('phone',$('#candidatePhone').value);fd.append('job_id',$('#candidateJob').value);fd.append('file',$('#candidateFile').files[0]);$('#candidateMsg').textContent='Uploading...';try{const r=await api('/api/candidates/upload',{method:'POST',body:fd});$('#candidateMsg').textContent=r.extraction_status==='pending'?'Uploaded. PDF/DOCX text extraction is the next module.':'Uploaded and text indexed.';e.target.reset();await refresh();loadCandidates()}catch(err){$('#candidateMsg').textContent=err.message}}
window.rule=async id=>{try{const r=await api('/api/screenings/rule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({application_id:id})});showResult(r);await refresh();loadApps()}catch(e){showResult({error:e.message})}}
window.ai=async id=>{try{const r=await api('/api/ai/screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({application_id:id})});showResult(r);await refresh();loadApps()}catch(e){showResult({error:e.message})}}
function showResult(x){$('#result').classList.remove('hidden');$('#resultText').textContent=JSON.stringify(x,null,2)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
async function boot(){try{const r=await api('/api/auth/me');$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=r.user.name+' · '+r.user.organization_name;await refresh()}catch{}}
boot();
</script></body></html>`));

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
