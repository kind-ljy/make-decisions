/**
 * MakeDecisions · Deno Deploy 后端
 *
 * 与 worker/worker.js 等价；改写为 Deno 标准 ServeHandler。
 * 部署：
 *   1. https://dash.deno.com 创建项目（可直接连 GitHub repo，或 deployctl 上传）
 *   2. 在项目 Settings → Environment Variables 里添加：
 *        ZHIPU_API_KEY  = <你的智谱新 Key>
 *        ALLOWED_ORIGINS = *  （上线后改成你的 Pages 域名）
 *   3. 入口文件指向：deno/main.ts
 */

const ZHIPU_CHAT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const ZHIPU_IMAGE = "https://open.bigmodel.cn/api/paas/v4/images/generations";

function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

function requireKey(): string {
  const k = env("ZHIPU_API_KEY");
  if (!k) throw new Error("ZHIPU_API_KEY 未配置");
  return k;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function applyCors(resp: Response, request: Request): Response {
  const allow = (env("ALLOWED_ORIGINS", "*")).trim();
  const reqOrigin = request.headers.get("Origin") || "";
  let origin = "*";
  if (allow !== "*") {
    const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
    origin = list.includes(reqOrigin) ? reqOrigin : (list[0] || "*");
  }
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(resp.body, { status: resp.status, headers: h });
}

function safeSlice(s: string, n: number): string {
  return typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : (s ?? "");
}

/* -------------------- 路由 -------------------- */

async function handleTurn(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: "messages 必填" }, 400);
  }

  const payload = {
    model: "glm-4-flash",
    messages: body.messages,
    temperature: typeof body.temperature === "number" ? body.temperature : 0.85,
    response_format: { type: "json_object" },
  };

  const upstream = await fetch(ZHIPU_CHAT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + requireKey(),
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: "upstream " + upstream.status, detail: safeSlice(text, 400) }, 502);
  }

  let data: any;
  try { data = JSON.parse(text); } catch { return json({ error: "上游返回非 JSON" }, 502); }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) return json({ error: "上游无内容" }, 502);

  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch { return json({ error: "AI 输出非 JSON", raw: safeSlice(content, 400) }, 502); }
    } else {
      return json({ error: "AI 输出非 JSON", raw: safeSlice(content, 400) }, 502);
    }
  }

  return json({ ok: true, result: parsed, usage: data?.usage });
}

async function handleImage(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body?.prompt || typeof body.prompt !== "string") {
    return json({ error: "prompt 必填" }, 400);
  }

  const payload = {
    model: "cogview-3-flash",
    prompt: String(body.prompt).slice(0, 500),
    size: body.size || "1024x1024",
  };

  const upstream = await fetch(ZHIPU_IMAGE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + requireKey(),
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: "upstream " + upstream.status, detail: safeSlice(text, 400) }, 502);
  }

  let data: any;
  try { data = JSON.parse(text); } catch { return json({ error: "图片接口返回非 JSON" }, 502); }

  const imageUrl = data?.data?.[0]?.url;
  if (!imageUrl) return json({ error: "图片接口未返回 URL" }, 502);

  return json({ ok: true, url: imageUrl });
}

/* -------------------- 入口 -------------------- */

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === "OPTIONS") {
    return applyCors(new Response(null, { status: 204 }), request);
  }

  try {
    if (url.pathname === "/api/health") {
      return applyCors(json({ ok: true, time: Date.now() }), request);
    }
    if (request.method !== "POST") {
      return applyCors(json({ error: "Method not allowed" }, 405), request);
    }
    if (url.pathname === "/api/turn") {
      return applyCors(await handleTurn(request), request);
    }
    if (url.pathname === "/api/image") {
      return applyCors(await handleImage(request), request);
    }
    return applyCors(json({ error: "Not found" }, 404), request);
  } catch (e: any) {
    console.error(e);
    return applyCors(json({ error: e?.message || "Internal error" }, 500), request);
  }
});
