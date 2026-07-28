# 图片链路重构与测试环境验收报告

报告日期：2026-07-28  
分支：`fix/media-pipeline-rebuild`  
核心提交：`799b5a4`、`d46a1de`  
测试站：[https://jinshan20-test.pages.dev/](https://jinshan20-test.pages.dev/)  
不可变部署：[https://8197210d.jinshan20-test.pages.dev/](https://8197210d.jinshan20-test.pages.dev/)

## 1. 调研结论

### Donaldcwl/browser-image-compression

- 仓库：https://github.com/Donaldcwl/browser-image-compression
- 维护者：Donaldcwl
- 2026-07-28 查询：1,708 Stars；最近仓库更新时间 2026-07-26；最近代码推送 2024-03-08。
- 最新发布：v2.0.2，2023-03-06。
- 许可证：MIT；浏览器库提供 TypeScript 类型。
- 采用内容：`useWebWorker`、`maxSizeMB`、`maxWidthOrHeight`、`fileType`、
  `initialQuality`、`onProgress` 和 `AbortSignal`。
- 未照搬内容：示例 UI、业务上传接口和服务端逻辑。
- 风险：iOS/微信仍受浏览器内存、Canvas 尺寸和 Web Worker 支持差异影响，因此保留
  主线程降级路径和逐张并发上限。

### yusukebe/r2-image-worker

- 仓库：https://github.com/yusukebe/r2-image-worker
- 维护者：yusukebe
- 2026-07-28 查询：394 Stars；最近仓库更新时间 2026-07-28；最近推送 2025-10-23。
- package 版本 2.0.0；TypeScript；package 声明 MIT，但仓库根目录未发现独立 LICENSE 文件。
- 采用内容：R2 `get`、`caches.default.match/put`、`ctx.waitUntil`、ETag、
  Content-Type、Cache-Control 和 404 分支。
- 未照搬内容：Basic Auth、Hono 路由结构和该项目的权限模型。
- 风险：许可证文件缺失，因此只参考平台 API 使用方式，不复制其成段源码。

### Cloudflare 官方实现

- 依据 Cloudflare R2 Presigned URL、S3 API 和 CORS 官方文档及
  `cloudflare/workers-sdk`、`cloudflare/cloudflare-docs` 示例。
- 使用 `aws4fetch` 生成短期 PUT 地址；浏览器直接上传压缩文件到 R2；业务 Worker
  不再中转图片正文。
- Worker 只创建受限对象 Key、确认 R2 对象元数据并写 D1；客户端不能指定任意 Key。

## 2. 原链路的真实问题

1. 前端存在手写 Canvas 压缩分支，移动端大图处理容易阻塞主线程。
2. 压缩后的文件曾先进入业务 Worker，再由 Worker 写 R2，增加一次完整正文中转。
3. 列表接口只返回对象信息时，页面还需要逐张获取图片地址，形成串行/N+1 请求。
4. 私密图片每次查看均重复鉴权和查表；稳定 URL 复用不足。
5. 只设置 Cache-Control 的旧路径没有实际执行 Cache API，不能证明边缘命中。
6. 管理员打开页面曾请求完整 `/api/admin/dashboard`，为当天每个学生及每张图片生成
   数据和签名；用户抽屉还会同时初始化不常用资料。
7. 管理员列表与详情、全屏查看曾可能重复下载同一图片。
8. 历史图片仍走兼容路径；新链路不再写原图/展示图/高清图三套数据。

## 3. 新上传流程

1. 选择图片后立即按真实 MIME 和 5 MiB 上限逐张校验。
2. `browser-image-compression` 在浏览器端处理方向、尺寸和 WebP 编码。
3. 默认最长边 1600px、质量 0.90；超出目标后依次尝试 0.88、0.86，
   必要时降到 1440px 或 1200px；小图不放大。
4. 前端向 `/api/media/upload-intents` 申请短期 PUT URL。
5. 浏览器将最终 WebP 直接 PUT 到测试 R2。
6. 前端调用确认接口；Worker 使用 R2 HEAD 验证对象存在、大小、MIME、Key、所有者、
   任务关系和意图有效期，再由 D1 batch 写入 `media_objects` 并确认意图。
7. 数据库只保存最终压缩文件；不保存、不提供原图或高清图切换。

处理状态依次显示“正在处理图片、正在压缩图片、正在上传、上传完成”。超过 5 MiB、
不支持格式或压缩失败均使用项目自定义提示，不使用浏览器原生弹窗。

## 4. 数据结构和 R2 路径

新增表：

- `media_upload_intents`：用户、任务、业务类型、对象 Key、MIME、期望大小、宽高、
  状态、过期时间、确认时间和时间戳。
- `media_objects`：所有者、任务、业务类型/业务 ID、对象 Key、MIME、最终大小、
  宽高、ETag、公开性和时间戳。

新增索引覆盖用户时间、意图状态/过期时间、对象所有者时间、公开性时间。

新对象 Key 由服务端生成，测试环境固定在 `media/test/{user-id}/...webp` 范围；客户端
不能传入任意 R2 路径。正式环境将使用独立 Bucket 和 `media/production/` 范围。

旧字段和旧表暂时保留只读兼容，避免历史图片丢失；新上传不再写原图地址。

## 5. 图片读取和权限

### 活动广场公开图片

`/api/public-media/{media-id}` 使用稳定 URL。处理顺序：

`caches.default.match` → 未命中时 `R2.get` → 设置 ETag/长度/MIME/一年 immutable
缓存 → `ctx.waitUntil(cache.put)`。

公开图片不再每次查 D1 或执行登录鉴权。

### 用户自己的私密图片

提交记录接口直接批量返回短期 HMAC 地址。签名绑定媒体 ID、用户受众和过期时间；
有效期内复用，不为每张图片额外申请 URL，也不在每次读取时查询 D1。

### 管理员审核图片

管理员的单用户记录接口一次返回该用户当天所需签名地址。签名绑定管理员受众并短期
有效；未展开记录时不请求。管理员不能把私密地址当永久公开地址传播。

历史 `/api/files` 仅作兼容。新媒体不通过该路径，新公开媒体使用 Cache API，新私密
媒体使用 HMAC 路径。

## 6. 缓存真实验证

同一测试媒体连续请求三次：

| 次数 | 状态 | Content-Type | 长度 | ETag | 缓存 | TTFB | 总时间 |
|---|---:|---|---:|---|---|---:|---:|
| 1 | 200 | image/png | 75,233 B | `"344c...7930"` | `X-Media-Cache: MISS` | 4.422s | 4.892s |
| 2 | 200 | image/png | 75,233 B | 同上 | `CF-Cache-Status: HIT`, Age 1 | 1.148s | 1.646s |
| 3 | 200 | image/png | 75,233 B | 同上 | `CF-Cache-Status: HIT`, Age 3 | 0.989s | 1.648s |

三次均返回 `Cache-Control: public, max-age=31536000, immutable`。后两次明确为 Cloudflare
HIT，证明没有再次读取 R2。绝对耗时受本次测试机到 SIN 节点链路影响。

## 7. 压缩矩阵

以下使用真实图片、项目当前 v2.0.2 浏览器库、Android 微信 UA、390×844、Fast 4G、
4 倍 CPU 降速模拟。PSNR 在浏览器缩放后的同尺寸图上计算。

| 场景 | 原文件 | 原尺寸 | 最终 WebP | 最终尺寸 | 压缩耗时 | 体积比 | PSNR |
|---|---:|---:|---:|---:|---:|---:|---:|
| 横向手机照片 | 4,905,873 B | 4096×2748 | 222,608 B | 1600×1073 | 383ms | 4.54% | 41.35dB |
| 竖向 PNG | 5,131,493 B | 1800×2400 | 227,718 B | 1200×1600 | 335ms | 4.44% | 40.34dB |
| 含文字宽图 | 4,304,202 B | 5853×2529 | 182,458 B | 1600×691 | 346ms | 4.24% | 40.94dB |
| 复杂细节方图 | 4,518,943 B | 2500×2500 | 940,768 B | 1600×1600 | 463ms | 20.82% | 42.09dB |
| 超 5 MiB PNG | 6,485,203 B | 1800×2400 | 未处理 | 未处理 | 压缩前拒绝 | — | — |

iPhone 微信 UA 模拟补测：

- 横向照片：222,608 B，450ms，PSNR 41.35dB。
- 竖向照片：227,718 B，346ms，PSNR 40.34dB。

PSNR 均超过 40dB，自动对比未发现明显色块、涂抹或拉伸；这不替代真人对人脸、文字、
食物、建筑细节的真机肉眼验收。

## 8. 真实 Cloudflare 上传数据

测试 R2/D1 的一次浏览器直传：

- 输入 PNG：75,233 B，1011×927。
- 输出 WebP：46,506 B。
- Android 微信 UA 模拟压缩：112ms。
- 申请上传地址：1,040ms。
- 浏览器直传 R2：1,282ms。
- D1 确认：999ms。
- 桌面同对象链路：登录 1,692ms、意图 397ms、PUT 1,445ms、确认 1,391ms。

R2 对象存在，确认接口完成后 D1 记录完整；未使用业务 Worker中转图片正文。

## 9. 管理员移动端交互

管理员首页不再请求完整 `/api/admin/dashboard`，改为：

- `/api/admin/completion-summary`：仅赛道完成聚合。
- `/api/admin/users?...`：分页用户摘要。
- `/api/admin/users/{id}/checkins`：仅点击用户后加载该用户当天记录并生成必要签名。

手机端点击用户：

- 抽屉框架先出现，本次线上测得 6–11ms。
- 默认只显示姓名、学号、状态、赛道和最近状态。
- 最近打卡记录默认展开并异步读取。
- 基本资料、所属队伍、补卡权限、管理员代补、管理操作默认折叠。
- 未展开折叠区不请求数据；同一时间只展开一个区域。
- 关闭后保留用户列表筛选、搜索和滚动位置。

用户方格为四列紧凑布局，只显示序号、姓名；完成者右上角显示勾，未完成者保持灰色，
不再显示“未完成”和累计天数。累计天数仅在详情摘要中出现。

## 10. 全屏图片与返回

- 点击任务图片立即创建黑色全屏查看器，继续使用列表中同一 URL，不请求原图。
- 已缓存图片首次点击到显示 3ms；第二次打开同一图片 3ms。
- 单击采用 220ms 判定窗口关闭查看器；实测约 289ms 后回到同一抽屉和同一记录。
- 系统返回键/微信返回先关闭查看器；抽屉和记录状态保留。
- 移动超过 8px、双指缩放或双击不会被当成单击关闭。

## 11. 活动广场

- 服务端 `page=1&limit=20`，不是全量读取后前端截断。
- 帖子列表不同时加载全部评论；评论进入帖子后再取。
- 图片使用懒加载；第一屏提高优先级；返回保留已加载内容和滚动位置。
- iPhone 微信 UA + Fast 4G + 4×CPU 模拟：第一条内容 618ms，第一张图片 913ms，
  页面无横向溢出。

## 12. 页面与设备测试

### Android 微信 UA 模拟

- 首页中文标题正确，无横向溢出。
- 管理首页初始请求中不存在 `/api/admin/dashboard`。
- 抽屉框架 6–11ms。
- 有历史图片的单用户记录首次图片 2,093ms；同图全屏 3ms；再次打开 3ms。
- 2,093ms 主要来自历史兼容图片首次网络请求；新公开图片命中 Cache API 后明显更快。

### iPhone 微信 UA 模拟

- 首页 FCP 约 1,000ms，无横向溢出。
- 管理用户 17 条正常显示，不请求完整 dashboard。
- 活动广场首内容 618ms、首图 913ms。

以上是 Chrome DevTools 的微信 UA、手机视口、Fast 4G 和 CPU 降速模拟，不是实体
Android 微信或实体 iPhone 微信。由于当前环境无法远程控制用户手机，真机测试不能
写“通过”，仍需用户在测试地址完成最终验收。

## 13. 自动化与并发

- Node 自动化：27/27 通过。
- 覆盖上传意图、确认、签名、越权、篡改、公开/私密路由、缓存和核心业务回归。
- 本地基础 700 登录：700 成功，总耗时 17.698s、P95 16.515s；该旧 JSON 本地压力结果不代表 D1/R2，
  也未达到 5 秒目标。
- 本地 700 读取：700 成功，总耗时 323ms、P95 48ms、吞吐 2,167.35 次/秒。
- 本轮没有执行 700 个真实用户同时上传 3.5GB：该操作会消耗免费额度并需要专门授权，
  不能伪造为已完成。

## 14. 文件修改清单

- `public/vendor/browser-image-compression-2.0.2.js`
- `public/vendor/browser-image-compression.LICENSE`
- `public/app.js`
- `public/style.css`
- `public/index.html`
- `cloudflare/worker.js`
- `cloudflare/lib/media.js`
- `cloudflare/routes/media.js`
- `cloudflare/routes/admin.js`
- `cloudflare/routes/student.js`
- `cloudflare/routes/plaza.js`
- `cloudflare/pages-test/wrangler.jsonc`
- `cloudflare/pages-production/wrangler.jsonc`
- `migrations/production/0006_media_pipeline.sql`
- `migrations/production/0006_media_pipeline.rollback.sql`
- `tests/cloudflare-media.test.js`
- `scripts/media-browser-matrix.py`
- `.github/workflows/cloudflare.yml`
- `docs/MEDIA_PIPELINE_ROLLBACK.md`
- `docs/MEDIA_PIPELINE_TEST_REPORT.md`

## 15. 历史图片和替换清理

- 新上传只产生一个最终 WebP。
- 替换图片时新对象使用新 UUID URL，不会复用旧缓存键。
- 数据库关系在事务中切到新对象；旧媒体记录删除后，旧私密签名不能再建立有效业务关系。
- R2 旧 Key 通过 `ctx.waitUntil` 精确删除，不使用通配符。
- 旧公开 URL 可能在 immutable 缓存有效期内仍可读取，因此公开内容如有严格撤回要求，
  需要额外版本封禁表或主动清理 Cache API；当前实现不声称能瞬时清除全球已缓存公开副本。
- 历史图片尚未批量删除。必须先确认每条历史记录有可用最终图，再按清单迁移和删除，
  避免造成历史材料丢失。

## 16. 正式环境状态与风险

正式 Pages 代码没有被本轮覆盖，`main` 未部署。测试数据没有写入正式 D1/R2。

此前准备过程中正式 D1 已执行过加法迁移 0006，正式 R2 已设置 CORS 和媒体签名密钥；
这不会启用新前端，也不包含测试数据。正式 D1 备份位于本机：

`C:\Users\182504~1\AppData\Local\Temp\jinshan20-production-d1-backups\before-media-20260728-132419.sql`

正式上线前仍需：

1. 用户完成 Android 微信和 iPhone 微信真机验收。
2. 处理历史图片迁移清单。
3. 决定是否接受公开图片撤回后 CDN 仍可能短期缓存的语义。
4. 在正式环境补齐 R2 S3 Presigned PUT 凭据，但不得在源码或报告中保存密钥。
5. 重新跑正式环境小规模上传、权限和缓存验证，再切换 `main`。

## 17. 回滚

测试 Pages 可直接回滚到提交 `26155a0f289aa1b61721685c89fb61356164e8f8` 的部署。
源码可切换安全快照分支 `backup/pre-media-rebuild-20260727`。如需删除测试新表，使用
`0006_media_pipeline.rollback.sql`；执行前必须先核对测试媒资。完整步骤见
`docs/MEDIA_PIPELINE_ROLLBACK.md`。
