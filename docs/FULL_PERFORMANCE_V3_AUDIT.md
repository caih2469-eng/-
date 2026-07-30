# 全站性能 V3 审计与修复说明

日期：2026-07-30  
源码基线：`7992838a2633551c44c6ad47fa3a994ae48a4277`  
当前 `main` 与该基线仅相差一组无业务文件变更的清理提交。  
修复分支：`fix/full-performance-v3-20260730`

## 1. 修复范围

本轮不迁移框架、不新建 Cloudflare 项目、不改变 D1/R2 权限模型，集中处理真实移动端体验中仍然存在的四类等待：

1. `/api/session` 返回前，主应用资源尚未开始下载；
2. 多次 API 请求之间没有传递 D1 Session bookmark；
3. 餐食和材料图片仍生成不会用于公开列表的第二份缩略图；
4. 互动赛道个人打卡快速上传仍有多次 D1 查询和重复 R2 HEAD 往返。

## 2. 审计后保留的现有实现

以下现有设计是正确的，本轮没有推倒重写：

- 学生首页已经使用单个 `/api/session` 聚合首屏数据；
- 返回学生首页时先恢复内存缓存，再后台静默刷新；
- 个人打卡已经使用专用单请求上传接口，支持立即本地预览、幂等和乐观返回；
- 广场列表使用 SQL 分页和缩略图，图片查看器先显示缩略图再升级展示图；
- 公开图片进入边缘缓存，私有图片继续使用受保护签名地址；
- GET 请求已有合并、超时、有限重试和性能记录；
- 图片压缩继续使用本站固定版本 `browser-image-compression@2.0.2`，并保留微信/iOS 低并发策略。

## 3. 本轮实际代码修改

### 3.1 启动资源并行获取

`public/bootstrap.js` 在请求 `/api/session` 的同时预加载：

- `style.css`
- `performance-v3.js`
- `site-path.js`
- `app.js`

会话成功后，只需要执行已进入浏览器缓存的脚本，不再等会话结束后才开始逐个下载。图片压缩库不抢占首屏带宽，而是在主应用启动后空闲预热。

### 3.2 D1 Sessions 与 bookmarks

新增 `cloudflare/lib/d1-session-wrapper.js`，由测试、预发布和正式 Pages Functions 入口统一调用：

- GET、HEAD 和 `/api/session` 使用 `first-unconstrained` 作为无 bookmark 时的首选；
- 写请求使用 `first-primary`；
- Worker 响应返回 `x-d1-bookmark`；
- `bootstrap.js` 和 `performance-v3.js` 在当前标签页会话中保存并传递 bookmark；
- 没有执行 D1 查询的响应不会因为 `getBookmark()` 抛错；
- 原 Worker 已存在的 `x-request-id` 和 `server-timing` 被保留，优化路由缺失时由包装层补充。

参考：

- Cloudflare D1 Sessions API：https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession
- Cloudflare D1 read replication：https://developers.cloudflare.com/d1/best-practices/read-replication/

### 3.3 非公开列表图片取消第二次压缩和三次网络往返

新增 `public/performance-v3.js`。在不改动大型 `app.js` 主流程的前提下，仅对以下业务的 thumb 阶段做本地兼容层：

- `meal-checkin`
- `material-image`
- `member-checkin`

执行方式：

1. display 上传和服务端确认成功后，记录下一次 360px thumb 为可跳过；
2. 包装图片压缩函数，直接复用已压缩 display 文件，不再执行第二次 Canvas 压缩；
3. thumb 的“申请地址、PUT、确认”在本地返回兼容响应，不产生真实网络请求；
4. 最终业务提交仍只携带真实 display mediaId；
5. 服务端原有 `claimConfirmedMedia` 已允许 thumb 缺失，并在历史记录中回退 display。

`task` 图片不在跳过列表中，因此互动任务和活动广场仍生成并上传真实 640px thumb，列表画质和公开缓存逻辑不变。

### 3.4 个人打卡快速上传减少服务端往返

新增：

- `cloudflare/routes/member-fast-v3.js`
- `cloudflare/routes/member-fast-v3-safe.js`

Pages Functions 对 `/api/media/member-checkin-fast` 优先使用新实现，其他 API 继续进入原 `worker.js`。

新实现：

- 任务和队伍读取合并成一次 D1 batch；
- 上传意图写入、意图读取和已有媒体读取合并成一次 D1 batch；
- 使用 `R2.put()` 返回的对象信息验证大小和 MIME；
- 删除写入前、写入后的两次冗余 `R2.head()`；
- 保留真实文件头、最长边 960px、300KB、SHA-256、幂等编号、任务时间窗、队伍权限和失败对象清理；
- 通过安全包装器继续返回原有 JSON 错误格式，而不是暴露 Pages 通用 500 页面。

R2 对新对象写入提供强一致性，因此成功的 `put()` 后不需要立即再做两次 HEAD 才能确认同一个对象。

参考：

- Cloudflare R2 consistency：https://developers.cloudflare.com/r2/reference/consistency/
- Cloudflare R2 Worker API：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

### 3.5 缓存版本与静态文件

- `index.html` 使用 `20260730-perfv3` 启动版本；
- `performance-v3.js` 使用一年 immutable 缓存，并由版本参数负责更新；
- `bootstrap.js` 继续 no-store，避免微信长期停留在旧启动代码；
- 登录入口保持独立，不强制下载主应用。

## 4. 未采用的方案

- 不切换到 Squoosh 或大型 WASM 图片编码器：会增加资源体积、CPU、内存及微信/iOS WebView 风险；
- 不提高微信/iOS 多图并发：内存稳定性优先；
- 不把私有图片加入共享 Cache API；
- 不降低任务广场缩略图质量；
- 不更换现有 Presigned PUT、D1、R2 或 Pages 项目；
- 不直接推送 `main`，不自动部署生产站。

## 5. 修改文件

- `public/bootstrap.js`
- `public/index.html`
- `public/_headers`
- `public/performance-v3.js`
- `cloudflare/lib/d1-session-wrapper.js`
- `cloudflare/routes/member-fast-v3.js`
- `cloudflare/routes/member-fast-v3-safe.js`
- `cloudflare/pages-test/functions/[[path]].js`
- `cloudflare/pages-staging/functions/[[path]].js`
- `cloudflare/pages-production/functions/[[path]].js`
- `test/full-performance-v3.test.js`
- `test/stage-g-observability-assets.test.js`

没有数据库迁移，也没有删除历史 D1/R2 数据。

## 6. 自动验证

PR 必须通过：

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:text
pnpm test
```

专项测试检查：

- 新浏览器脚本语法；
- 主应用资源预加载；
- D1 bookmark 前后端传递；
- 三套 Pages 环境使用 D1 Session；
- 非任务 thumb 不执行第二次压缩和三次网络请求；
- 新个人打卡路由不再调用 `R2.head()`；
- 错误继续转换为 JSON 响应。

## 7. 上线与真机验收

1. 确认 Draft PR 的自动测试全部通过；
2. 将 PR 标记为可审查并合并到 `main`；
3. 现有 `Cloudflare validation and deployment` 工作流自动运行测试并部署 `jinshan20`；
4. 上线后完全关闭微信和 QQ 再重新打开；
5. 分别验证：登录、学生首页、广场返回、个人打卡、任务多图、餐食打卡、材料上传、历史记录和管理员页面；
6. 使用 `?debugPerf=1` 时可在控制台查看现有请求、压缩、上传、提交和首页恢复耗时。

自动测试只能验证代码与本地流程，最终秒数必须以正式网络和真实微信/QQ设备为准。