# 部署指南 · MakeDecisions

游戏分两部分：
- **前端**：单文件 `index.html`
- **后端**：选一个 Serverless 平台部署（推荐 Deno Deploy）

---

## ⚠️ 关于后端选型

我们提供了两套后端实现：

| 实现 | 路径 | 说明 |
|------|------|------|
| **Deno Deploy** | `deno/main.ts` | ⭐ **推荐**。免费域名 `*.deno.dev` 国内可访问 |
| Cloudflare Workers | `worker/worker.js` | 备选。免费域名 `*.workers.dev` **国内被 DNS 污染**，仅适合配自定义域名时使用 |

**国内用户首选 Deno Deploy。** 详细步骤见 `deno/README.md`。

---

## 一、部署后端（Deno Deploy 路线）

### 1. 创建项目（Web UI 最快）

1. 打开 https://dash.deno.com，用 GitHub 登录
2. 「New Project」→ 「Playground」
3. 把 `deno/main.ts` 全部内容粘贴进去

### 2. 设置环境变量

项目页 → **Settings → Environment Variables**：

```
ZHIPU_API_KEY  = <你的智谱新 Key>
ALLOWED_ORIGINS = *
```

> 上线后把 `ALLOWED_ORIGINS` 改成具体的 Pages 域名（如 `https://make-decisions.pages.dev`）。

### 3. 保存并部署

点 「Save & Deploy」。顶部会显示一个 URL，例如：
```
https://make-decisions-api.deno.dev
```

### 4. 验证

```bash
curl https://make-decisions-api.deno.dev/api/health
# {"ok":true,"time":...}

curl -X POST https://make-decisions-api.deno.dev/api/turn \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"返回 JSON: {\"hi\":\"ok\"}"}]}'
# {"ok":true,"result":{"hi":"ok"},...}
```

---

## 二、部署前端到 Cloudflare Pages

> Pages 走的是 Cloudflare 的标准 CDN（`*.pages.dev`），**国内可访问**，不像 workers.dev 被污染。

```bash
# 安装 wrangler（一次性）
npm install -g wrangler
wrangler login

# 在仓库根目录部署
cd /Users/klaylli/Documents/UGit/make-decisions
wrangler pages deploy . --project-name make-decisions
```

首次部署会自动创建项目，输出形如：
```
✨ Deployment complete!
  https://make-decisions.pages.dev
```

---

## 三、配置游戏

打开你的 Pages URL（或本地的 `index.html`），点右上角 ⚙：

1. 打开 **「使用 Worker 后端」** 开关
2. 在 **「Worker 后端地址」** 里填你的 Deno URL，例如：
   ```
   https://make-decisions-api.deno.dev
   ```
3. 点 **保存设置**
4. 关掉设置面板，开一局新故事 → 走通即代表全链路 OK

---

## 四、上线安全收尾

1. **撤销旧 Key**：去 https://bigmodel.cn 控制台把开发期 Key（`d60130...`）删掉
2. **收紧 CORS**：在 Deno Deploy 项目设置里把 `ALLOWED_ORIGINS` 改成 `https://make-decisions.pages.dev`，触发重新部署
3. **确认前端没有 Key**：当前 `index.html` 的 `DEFAULT_API_KEY` 已为空字符串 ✅

---

## 五、成本估算

| 服务 | 费用 |
|------|------|
| 智谱 GLM-4-Flash | **永久免费**，无限调用 |
| 智谱 CogView-3-Flash | 新用户赠送额度，常规调用每张 ¥0.01 量级 |
| Deno Deploy | 免费 100 万次/月 |
| Cloudflare Pages | 免费、无限带宽 |

零成本运营足以撑个人项目和小规模玩家。
