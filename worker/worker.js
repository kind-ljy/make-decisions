/**
 * MakeDecisions · Cloudflare Worker 后端代理
 *
 * ⚠️ 国内用户注意：
 * `*.workers.dev` 在国内被 DNS 污染 + SNI 阻断，无法直接访问。
 * 国内首选用 `deno/main.ts` 部署到 Deno Deploy（详见 DEPLOY.md）。
 * 仅当你绑定自定义域名（走 Cloudflare 标准 CDN）时再考虑这个 Worker 版本。
 *
 * 职责：
 *   1. 转发前端请求到智谱 API，注入 ZHIPU_API_KEY
 *   2. 统一 CORS、错误处理、JSON 解析
 *   3. IP 限流（基于 KV，可选；未绑定 KV 时跳过）
 *   4. 暴露两个端点：
 *        POST /api/turn   - 调用 GLM-4-Flash 生成下一回合（输入 messages）
 *        POST /api/image  - 调用 CogView-3-Flash 生成场景配图（输入 prompt）
 *
 * 部署：
 *   cd worker
 *   npx wrangler login
 *   npx wrangler secret put ZHIPU_API_KEY     # 粘贴你的智谱 Key
 *   npx wrangler deploy
 */

const ZHIPU_CHAT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_IMAGE = 'https://open.bigmodel.cn/api/paas/v4/images/generations';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), env, request);
    }

    if (request.method !== 'POST') {
      return cors(json({ error: 'Method not allowed' }, 405), env, request);
    }

    // IP 限流
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limited = await checkRateLimit(env, ip);
    if (limited) {
      return cors(json({ error: '今日调用次数已达上限，请明天再来。' }, 429), env, request);
    }

    try {
      if (url.pathname === '/api/turn') {
        return cors(await handleTurn(request, env), env, request);
      }
      if (url.pathname === '/api/image') {
        return cors(await handleImage(request, env), env, request);
      }
      if (url.pathname === '/api/health') {
        return cors(json({ ok: true, time: Date.now() }), env, request);
      }
      return cors(json({ error: 'Not found' }, 404), env, request);
    } catch (e) {
      console.error(e);
      return cors(json({ error: e.message || 'Internal error' }, 500), env, request);
    }
  },
};

/* -------------------- 路由 -------------------- */

async function handleTurn(request, env) {
  const body = await request.json();
  // 期待前端传 { messages, temperature? }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'messages 必填' }, 400);
  }

  const payload = {
    model: 'glm-4-flash',
    messages: body.messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.85,
    response_format: { type: 'json_object' },
  };

  const upstream = await fetch(ZHIPU_CHAT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + requireKey(env),
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: 'upstream ' + upstream.status, detail: safeSlice(text, 400) }, 502);
  }

  let data;
  try { data = JSON.parse(text); }
  catch { return json({ error: '上游返回非 JSON' }, 502); }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) return json({ error: '上游无内容' }, 502);

  // 兜底：尝试解析 JSON-in-JSON
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch { return json({ error: 'AI 输出非 JSON', raw: safeSlice(content, 400) }, 502); }
    } else {
      return json({ error: 'AI 输出非 JSON', raw: safeSlice(content, 400) }, 502);
    }
  }

  return json({
    ok: true,
    result: parsed,
    usage: data?.usage,
  });
}

async function handleImage(request, env) {
  const body = await request.json();
  if (!body.prompt || typeof body.prompt !== 'string') {
    return json({ error: 'prompt 必填' }, 400);
  }

  const payload = {
    model: 'cogview-3-flash',
    prompt: body.prompt.slice(0, 500),
    size: body.size || '1024x1024',
  };

  const upstream = await fetch(ZHIPU_IMAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + requireKey(env),
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: 'upstream ' + upstream.status, detail: safeSlice(text, 400) }, 502);
  }

  let data;
  try { data = JSON.parse(text); }
  catch { return json({ error: '图片接口返回非 JSON' }, 502); }

  const imageUrl = data?.data?.[0]?.url;
  if (!imageUrl) return json({ error: '图片接口未返回 URL' }, 502);

  return json({ ok: true, url: imageUrl });
}

/* -------------------- 工具 -------------------- */

function requireKey(env) {
  const k = env.ZHIPU_API_KEY;
  if (!k) throw new Error('ZHIPU_API_KEY 未配置（请用 wrangler secret put）');
  return k;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cors(resp, env, request) {
  const allow = (env.ALLOWED_ORIGINS || '*').trim();
  const reqOrigin = request.headers.get('Origin') || '';
  let origin = '*';
  if (allow !== '*') {
    const list = allow.split(',').map(s => s.trim()).filter(Boolean);
    origin = list.includes(reqOrigin) ? reqOrigin : list[0] || '*';
  }
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, headers: h });
}

function safeSlice(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* -------------------- 限流（KV 可选） -------------------- */

async function checkRateLimit(env, ip) {
  if (!env.RATE_KV) return false; // 没绑 KV 就不限
  const limit = parseInt(env.RATE_LIMIT_PER_DAY || '100', 10);
  if (!limit) return false;
  const today = new Date().toISOString().slice(0, 10);
  const key = `rl:${today}:${ip}`;
  const cur = parseInt((await env.RATE_KV.get(key)) || '0', 10);
  if (cur >= limit) return true;
  // 异步累加，1 天 TTL
  await env.RATE_KV.put(key, String(cur + 1), { expirationTtl: 86400 });
  return false;
}
