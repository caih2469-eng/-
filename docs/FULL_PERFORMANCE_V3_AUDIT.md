# 全站性能 V3 审计与修复说明

日期：2026-07-30  
基线提交：`7992838a2633551c44c6ad47fa3a994ae48a4277`  
修复分支：`fix/full-performance-v3-20260730`

## 目标

本轮不迁移框架、不新建 Cloudflare 项目、不改变 D1/R2 权限模型，集中处理真实移动端体验中仍然存在的四类等待：

1. 已登录启动阶段等待 `/api/session` 后才开始下载主应用资源；
2. D1 多次请求之间没有传递 Session bookmark，跨请求一致性和副本选择无法复用；
3. 普通图片上传为所有业务生成 display + thumb，材料和餐食截图产生不必要的第二次压缩与三次网络往返；
4. 互动赛道个人打卡快速上传仍包含多次 D1 查询和重复 R2 HEAD 校验。

## 审计结论

### 已经保留的正确实现

- 学生首页已经使用单个 `/api/session` 聚合数据并缓存页面状态；返回首页时先恢复缓存，再后台刷新。
- 个人打卡已经使用专用单请求上传接口，并支持立即本地预览、幂等上传和提交成功后的乐观更新。
- 广场缩略图、图片查看器、公开图片边缘缓存、GET 请求合并、超时和错误提示均已存在。
- `browser-image-compression@2.0.2` 已固定在本站并使用同源 `libURL`，继续保留低并发策略，不引入额外 WASM 图片编码器。

### 本轮新增优化

#### 1. 启动资源与会话请求并行

`bootstrap.js` 在等待 `/api/session` 的同时预加载：

- `style.css`
- `site-path.js`
- `app.js`

会话成功后直接执行已预加载资源，减少受限 WebView 中的串行等待。

#### 2. D1 Sessions 与 bookmarks

Worker 每个请求创建 request-scoped D1 Session：

- GET/HEAD 无 bookmark 时使用 `first-unconstrained`；
- 写请求无 bookmark 时使用 `first-primary`；
- 响应返回 `x-d1-bookmark`；
- 前端在同一浏览会话中保存并传递 bookmark。

这样既允许只读请求选择更快副本，也保证用户写入后续读取满足顺序一致性。

参考：

- Cloudflare D1 Sessions API：https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession
- Cloudflare D1 read replication：https://developers.cloudflare.com/d1/best-practices/read-replication/

#### 3. 删除无价值缩略图上传

只有会在广场列表展示的 `task` 图片继续生成 640px thumb。

以下业务只上传 display：

- `member-checkin`
- `meal-checkin`
- `material-image`

服务端对应使用 `claimConfirmedMedia(..., { loadThumb: false })`，历史记录在无 thumb 时继续回退到 display，不改变权限和数据结构。

#### 4. 任务图片压缩与上传重叠执行

互动任务图片在 display 压缩完成后：

- display 上传开始；
- thumb 压缩同时进行；
- display 确认后再上传 thumb。

移动端仍保持 1 路图片并发，避免 iOS/微信多图解码内存风险，但减少单张图片内部的串行等待。

#### 5. 个人打卡快速上传减少往返

- 任务和队伍查询改为一次 D1 batch；
- 上传意图、意图读取和已有媒体读取改为一次 D1 batch；
- 使用 `R2.put()` 返回的对象元数据校验写入结果，删除写入前后的重复 `head()`；
- 保留 SHA-256、真实 MIME、尺寸、300KB 限制、幂等编号和失败清理。

R2 对象写入成功后具有强一致性，因此不需要为同一次新对象写入再做两次 HEAD 往返。

参考：

- Cloudflare R2 consistency：https://developers.cloudflare.com/r2/reference/consistency/
- Cloudflare R2 Worker API：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

#### 6. 图片组件空闲预热

学生首页完成后，通过 `requestIdleCallback` 或短延时后台加载图片压缩库。首次进入上传页时通常不再等待库脚本下载和解析。

## 不采用的方案

- 不改用 Squoosh 或其他大型 WASM 编码器：会增加主应用体积、CPU 和内存压力，并提高微信/iOS WebView 兼容风险。
- 不提高 iOS/微信的多图并发：移动设备解码和 Canvas 内存风险高于节省的网络时间。
- 不把私有图片放入共享 Cache API，不放宽签名 URL 或 R2 权限。
- 不直接修改 `main` 或正式站；先通过分支测试和 PR 审核。

## 自动验证

生成后的代码必须通过：

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:text
pnpm test
```

新增测试会检查：

- 前端与 Worker 的 D1 bookmark 传递；
- 启动资源预加载；
- 个人打卡快速上传不再执行冗余 R2 HEAD；
- 只有 `task` 图片生成 thumb；
- 餐食和材料上传不再加载 thumb。

## 上线方式

1. 在 PR 中确认自动测试通过；
2. 合并到 `main`；
3. 现有 `Cloudflare validation and deployment` 工作流会运行测试并部署正式项目 `jinshan20`；
4. 上线后在微信、QQ、Chrome 各测试一次：启动、返回、个人打卡、任务多图、材料上传、历史记录和广场图片。

本轮没有新增数据库迁移，也不删除历史 R2 对象。