import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

type Env = {
  DB: D1Database;
  CV_BUCKET: R2Bucket;
  APP_NAME: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  SESSION_SECRET?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", secureHeaders());
app.use("/api/*", cors({
  origin: (origin) => origin || "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"]
}));

const id = () => crypto.randomUUID();

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first();
  return c.json({
    ok: row?.ok === 1,
    app: c.env.APP_NAME,
    runtime: "cloudflare-workers",
    database: "d1",
    storage: "r2"
  });
});

app.get("/api/jobs", async (c) => {
  const org = c.req.query("organization_id");
  if (!org) return c.json({ error: "organization_id_required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT id,title,location,created_at FROM jobs WHERE organization_id=? ORDER BY created_at DESC"
  ).bind(org).all();
  return c.json(result.results);
});

app.post("/api/jobs", async (c) => {
  const body = await c.req.json<{
    organization_id: string;
    title: string;
    location?: string;
    description: string;
  }>();

  if (!body.organization_id || !body.title || !body.description) {
    return c.json({ error: "organization_id,title,description_required" }, 400);
  }

  const jobId = id();
  await c.env.DB.prepare(
    "INSERT INTO jobs(id,organization_id,title,location,description) VALUES(?,?,?,?,?)"
  ).bind(jobId, body.organization_id, body.title, body.location ?? "", body.description).run();

  return c.json({ id: jobId }, 201);
});

app.get("/api/candidates", async (c) => {
  const org = c.req.query("organization_id");
  if (!org) return c.json({ error: "organization_id_required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT id,name,email,phone,cv_filename,created_at FROM candidates WHERE organization_id=? ORDER BY created_at DESC"
  ).bind(org).all();
  return c.json(result.results);
});

app.post("/api/candidates", async (c) => {
  const body = await c.req.json<{
    organization_id: string;
    name: string;
    email?: string;
    phone?: string;
    cv_text?: string;
    cv_filename?: string;
  }>();

  if (!body.organization_id || !body.name) {
    return c.json({ error: "organization_id,name_required" }, 400);
  }

  const candidateId = id();
  await c.env.DB.prepare(
    "INSERT INTO candidates(id,organization_id,name,email,phone,cv_text,cv_filename) VALUES(?,?,?,?,?,?,?)"
  ).bind(
    candidateId, body.organization_id, body.name, body.email ?? "",
    body.phone ?? "", body.cv_text ?? "", body.cv_filename ?? ""
  ).run();

  return c.json({ id: candidateId }, 201);
});

app.post("/api/screenings/rule", async (c) => {
  const body = await c.req.json<{
    organization_id: string;
    application_id: string;
    cv_text: string;
    required_skills?: string[];
    min_years?: number;
  }>();

  const text = (body.cv_text || "").toLowerCase();
  const skills = body.required_skills ?? [];
  const hits = skills.filter((s) => text.includes(s.toLowerCase()));
  const technical = skills.length ? Math.round((hits.length / skills.length) * 100) : 100;
  const yearMatches = [...text.matchAll(/(\d+)\+?\s*(years?|tahun)/g)].map(m => Number(m[1]));
  const experience = !body.min_years
    ? 100
    : Math.min(100, Math.round((Math.max(0, ...yearMatches) / body.min_years) * 100));
  const score = Math.round(experience * 0.5 + technical * 0.5);

  const result = {
    overall_score: score,
    status: score >= 85 ? "Strong Match" : score >= 70 ? "Potential Match" : "Low Match",
    matched_skills: hits,
    missing_skills: skills.filter(s => !hits.includes(s)),
    note: "Rule-based screening. Recruiter review remains required."
  };

  await c.env.DB.prepare(
    "UPDATE applications SET score=?,status=?,analysis_json=? WHERE id=? AND organization_id=?"
  ).bind(
    score, result.status, JSON.stringify(result),
    body.application_id, body.organization_id
  ).run();

  return c.json(result);
});

app.post("/api/ai/screen", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: "ai_not_configured", message: "Set OPENAI_API_KEY as a Worker secret." }, 503);
  }

  const body = await c.req.json<{
    job_title: string;
    job_description: string;
    candidate_cv: string;
  }>();

  const model = c.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = [
    "Assess candidate fit for recruitment screening.",
    "Return JSON only with overall_score 0-100, summary, strengths array, gaps array, evidence array, recommendation, interview_questions array.",
    "Use only job-relevant evidence. Do not infer protected traits.",
    `JOB TITLE: ${body.job_title}`,
    `JOB DESCRIPTION: ${body.job_description.slice(0, 14000)}`,
    `CANDIDATE CV: ${body.candidate_cv.slice(0, 18000)}`
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    return c.json({ error: "ai_request_failed", status: response.status }, 502);
  }

  const data = await response.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return c.json({ error: "empty_ai_response" }, 502);

  return c.json(JSON.parse(content));
});

app.get("/", (c) => c.html(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${c.env.APP_NAME}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:60px auto;padding:20px}
.card{border:1px solid #ddd;border-radius:14px;padding:24px;margin:16px 0}
code{background:#f3f3f3;padding:3px 6px;border-radius:5px}
</style>
</head>
<body>
<h1>${c.env.APP_NAME}</h1>
<div class="card">
<h2>Cloudflare V6 Foundation</h2>
<p>Multi-tenant AI recruitment screening platform.</p>
<p>API health: <a href="/api/health">/api/health</a></p>
<p>Next modules: authentication, CV upload to R2, PDF/DOCX extraction, recruiter dashboard and full tenant isolation.</p>
</div>
</body>
</html>`));

export default app;
