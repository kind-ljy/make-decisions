# Deno Deploy 后端部署指南

> 因为 `*.workers.dev` 在国内被 DNS 污染，把后端从 Cloudflare Workers 迁到 Deno Deploy。
> Deno Deploy 的免费域名是 `*.deno.dev`，国内**可以直接访问**。

---

## 部署方式（任选其一）

### 方式 A：通过 Web UI 部署（最简单，推荐首次使用）

1. 浏览器打开 → https://dash.deno.com
2. 用 GitHub 账号登录
3. 点 **「New Project」**
4. 选 **「Deploy from a third-party repository」** → 但因为我们还没推 GitHub，先选 **「Deploy from CLI / Playground」** 中的 **「Playground」**
5. 进入 Playground → 把 `deno/main.ts` 全部内容**复制粘贴**进去
6. 在右上 **「Settings」**：
   - Environment Variables → 添加：
     - `ZHIPU_API_KEY` = `你的智谱新 Key`
     - `ALLOWED_ORIGINS` = `*`（先用 `*`，上线后再改成 Pages 域名）
7. 点 **「Save & Deploy」**
8. 顶部会出现部署的 URL：`https://<project-name>.deno.dev`

### 方式 B：通过 deployctl 命令行部署

```bash
# 1. 安装 deployctl（一次性）
deno install -gArf jsr:@deno/deployctl

# 2. 登录（浏览器会弹出 OAuth 授权页）
deployctl login

# 3. 部署（在仓库根目录）
cd /Users/klaylli/Documents/UGit/make-decisions
deployctl deploy --project=make-decisions-api --entrypoint=deno/main.ts --prod

# 4. 设置环境变量（需要在 dash.deno.com 上 GUI 设置，或通过 deployctl）
# 推荐去 https://dash.deno.com 项目页 → Settings → Environment Variables 添加：
#   ZHIPU_API_KEY = <你的智谱新 Key>
#   ALLOWED_ORIGINS = *
```

> ⚠️ 注意：deployctl 0.x 版本不能直接通过 CLI 设置 secret，必须去 dashboard 上手动加。

---

## 验证部署

部署完成后，假设 URL 是 `https://make-decisions-api.deno.dev`：

```bash
# 健康检查
curl https://make-decisions-api.deno.dev/api/health
# 应返回：{"ok":true,"time":1779...}

# LLM 调用（验证 ZHIPU_API_KEY 配置成功）
curl -X POST https://make-decisions-api.deno.dev/api/turn \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"返回 JSON: {\"hi\":\"ok\"}"}]}'
# 应返回：{"ok":true,"result":{"hi":"ok"},"usage":{...}}

# 图片接口
curl -X POST https://make-decisions-api.deno.dev/api/image \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a peaceful chinese garden, ink wash style"}'
# 应返回：{"ok":true,"url":"https://..."}
```

---

## 在前端切换到 Deno Deploy 后端

打开本地 `index.html`（双击或浏览器访问），右上角 ⚙：

1. 打开 **「使用 Worker 后端」** 开关（注意：UI 文字虽然写 "Worker"，逻辑上是任意 HTTP 后端代理都能用）
2. 在 **「Worker 后端地址」** 里填 `https://make-decisions-api.deno.dev`（**不要带末尾斜杠**）
3. 保存设置
4. 开一局新故事验证

---

## 上线安全收尾

部署到 Pages（或任何静态托管）拿到正式域名后：

1. 回到 **dash.deno.com → 项目 → Settings → Environment Variables**
2. 把 `ALLOWED_ORIGINS` 从 `*` 改成你的 Pages 域名，比如 `https://make-decisions.pages.dev`
3. 触发一次重新部署（在 dashboard 的 Deployments 标签里点 redeploy，或在 CLI 跑 `deployctl deploy --prod`）

---

## 免费额度

| 项 | 限额 |
|----|------|
| 请求数 | 100 万次/月 |
| 出站带宽 | 100 GB/月 |
| 单次执行 CPU | 50ms（够用） |
| 多区域部署 | ✅ 全球 |
| 国内可访问性 | ✅ 良好（大部分省份直连 OK） |

对个人项目而言完全够用。
