# 生产级图片与移动端登录性能修复报告

日期：2026-07-29  
分支：`fix/media-pipeline-rebuild`  
测试环境：`https://jinshan20-test.pages.dev`

## 1. 原始瓶颈

- 多处媒体 URL 独立拼接，曾产生 `//api/...`，Pages 会把这类地址当成静态站点回退并返回 HTML。
- 管理员与本人查看图片时，旧链路会在取得任务数据后再单独申请图片地址，并对每张图片重复鉴权。
- 公开图片虽然有 `Cache-Control`，但没有完整证明 `caches.default.match/put` 的边缘命中。
- 列表可能直接使用较大展示图，点击图片后才开始第一次请求，导致全屏查看器出现空白。
- 前端监听整个 `#app` 子树的 `MutationObserver` 会在每次变化后重复扫描所有表格和图片。
- 登录入口和主应用资源耦合；受限 WebView 中 Cookie/localStorage 状态不同步时会重复返回登录页。
- 本地预览 CSP 禁止内联首页启动脚本，使设备矩阵出现“登录成功但停在启动壳”的误判。

## 2. 完成的修复

- 统一 `normalizeSitePath/buildMediaUrl`，应用层生成的 API 与媒体路径只保留一个前导斜杠。
- 公开广场图片继续要求 `is_public=1` 且帖子 `status='visible'`，未发布图片不因后台需求而放宽权限。
- 私有图片由受保护接口服务，要求本人或管理员身份；不写共享 Cache API。
- 公开图片使用 `caches.default.match`、`ctx.waitUntil(cache.put(...))`、稳定版本 URL、ETag 和长缓存。
- 图片响应包含正确的 `Content-Type`、`Content-Length`、`ETag`、`Content-Disposition:inline`、`nosniff`、`X-Image-Cache` 与 `Server-Timing`，并支持 HEAD。
- 上传阶段生成 `thumb`（最长边 360）和 `display`（最长边 960）WebP；列表只用 thumb，全屏只升级到 display。
- 列表 SQL 层分页：广场最多 20 条，管理员用户最多 30 人；API 不返回 Base64。
- 删除全局 MutationObserver；每个渲染函数只对自己的容器执行一次图片与表格准备。
- 使用 IntersectionObserver 懒加载；点击图片立即用当前缩略图打开，展示图异步替换；失败仅允许人工重试一次。
- 登录页不加载 `app.js`；入口启用移动端降级、防重复提交和 10 秒 AbortController。
- 登录接口只返回 token 与最小 user；首页先验证 `/api/session`，再加载角色所需资源。
- 首页启动脚本移动到 `bootstrap.js`，与严格 CSP 兼容；本地服务器 Cookie/会话行为与 Cloudflare 对齐。

## 3. D1 查询计划

在测试与正式 D1 上执行 EXPLAIN QUERY PLAN：

- 用户登录命中 `idx_users_student_id`。
- `task_submission_images.submission_id` 使用既有索引。
- `plaza_posts(submission_id,status)` 与可见时间查询使用既有索引。
- `image_variants(source_type,source_id,variant)` 使用复合主键。
- 项目使用签名会话，不存在需要新增索引的 sessions 表。

未发现需要新增迁移的全表扫描，因此本轮没有新增数据库迁移。

## 4. Cloudflare 测试环境结果

### 700 用户流量模型

配置：700 个临时注册用户，登录并发 50、读取并发 100、20 秒超时。测试结束后已删除全部账号、上传意图、媒体记录和测试 R2 对象。

| 场景 | 成功率 | P50 | P95 | P99 | 最大值 |
|---|---:|---:|---:|---:|---:|
| 集中登录 | 700/700 | 480ms | 1118ms | 1312ms | 2414ms |
| 鉴权数据读取 | 700/700 | 1164ms | 1447ms | 1605ms | 1689ms |
| 排行榜读取 | 700/700 | 221ms | 793ms | 1057ms | 1113ms |
| 公开缩略图读取 | 700/700 | 690ms | 2980ms | 3973ms | 6388ms |

公开缩略图压测 700 次全部返回 32,034 字节 WebP，`X-Image-Cache=HIT` 和 `CF-Cache-Status=HIT` 均为 700 次。图片并发 P95 包含 100 路同时争抢压测机网络，不代表单用户查看耗时。

### 真实 R2 直传抽样

10 条完整流程，5 路并发，全部成功：

| 阶段 | P50 | P95 | 最大值 |
|---|---:|---:|---:|
| 上传意图 | 469ms | 534ms | 534ms |
| 浏览器直传 R2 | 1814ms | 2218ms | 2218ms |
| D1 确认 | 1096ms | 1353ms | 1353ms |
| 完整工作流 | 4642ms | 5147ms | 5147ms |

### 管理员与图片交互

Fast 4G、4 倍 CPU 降速、390×844 触摸视口：

| 操作 | 实测 |
|---|---:|
| 用户详情抽屉框架 | 13ms |
| 最近打卡记录接口完成 | 1136ms |
| 图片查看器框架 | 16ms |
| 冷缓存缩略图 | 307ms |
| 冷缓存展示图 | 404ms |
| 再次打开同一图片 | 23ms |
| 广场首条内容 | 349ms |
| 广场首张图片 | 368ms |

### 内置浏览器入口

Fast 4G、4 倍 CPU 降速：

| 环境 | TTFB | LCP | CLS |
|---|---:|---:|---:|
| Android 微信 UA | 105ms | 1565ms | 0 |
| iOS 微信 UA | 97ms | 1741ms | 0 |
| QQ 内置浏览器 UA | 120ms | 1578ms | 0 |

入口页只请求 HTML、WOFF2、`entrance.js` 和 favicon，没有请求 `app.js`。

注意：上述微信结果来自 Chrome DevTools 的 UA、触摸视口、Fast 4G 和 CPU 降速模拟，不是物理 iPhone/Android 真机测试，不能写成“真机通过”。

## 5. 修改文件

- `cloudflare/lib/runtime.js`
- `cloudflare/pages-production/functions/[[path]].js`
- `cloudflare/pages-test/functions/[[path]].js`
- `cloudflare/routes/admin.js`
- `cloudflare/routes/materials.js`
- `cloudflare/routes/media.js`
- `cloudflare/routes/plaza.js`
- `cloudflare/routes/student.js`
- `cloudflare/worker.js`
- `public/app.js`
- `public/bootstrap.js`
- `public/entrance.html`
- `public/entrance.js`
- `public/index.html`
- `public/site-path.js`
- `public/style.css`
- `server.js`
- `scripts/staging-upload-confirm-load.js`
- `test/media-pipeline-security.test.js`
- `test/phase1.test.js`
- `test/production-media-login-performance.test.js`
- `test/stage11-device-matrix.js`

## 6. 回滚

1. 在 Cloudflare Pages 中选择上一个已知稳定部署并执行 Rollback。
2. Git 回滚本轮提交后重新部署；生产部署必须对应已推送的 Git 提交。
3. 本轮无新数据库迁移，不需要执行 D1 回滚。
4. 若只需回退媒体管道，可参考 `docs/MEDIA_PIPELINE_ROLLBACK.md`。
5. 不要删除现有 R2 历史图片；代码保留旧字段和历史对象回退读取。

## 7. 尚存风险

- 尚未在物理 iPhone 微信、物理 Android 微信和 QQ 真机上记录数据。
- 生产库历史图片当前可能没有 thumb/display 变体，会走兼容回退；新上传图片会生成两种变体。
- 700 路图片压测受压测机出口带宽影响；边缘缓存已证明命中，但不同地区用户的实际下载时间仍取决于运营商网络。


## 8. 2026-07-29 微信图片二次提速

- 新上传图片的 `thumb` 最长边由 480 调整为 360，WebP 初始质量调整为 0.72，目标上限约 0.12MB。
- 新上传图片的 `display` 最长边由 1280 调整为 960，WebP 初始质量调整为 0.78，目标上限约 0.7MB。
- 全屏查看器优先复用列表中已经完成解码的缩略图，避免点击后重新等待缩略图。
- 展示图在内存中加载并完成 `decode()` 后再替换缩略图，减少 iOS WebView 的空白和切换抖动。
- 服务端上传意图同步限制为 thumb 360 / display 960，避免前后端参数不一致。
- 本轮不会自动改写历史 R2 对象；历史图片如果没有 thumb/display 变体，仍使用兼容回退。
- 这项调整主要降低新上传图片的下载量和解码像素量，不能保证所有运营商、所有首次访问节点固定达到某个秒数。
