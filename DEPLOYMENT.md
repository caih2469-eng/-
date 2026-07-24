# Cloudflare 上线部署说明

## 当前状态

本仓库的公开前端仍是静态 HTML/CSS/JavaScript，原业务后端仍是 Node.js +
JSON 文件。上线前测试已增加隔离的 Cloudflare Pages Functions、D1 和 R2
适配层，但它目前只覆盖登录、用户读取、任务读取、排行榜及压力测试上传。

因此：

- `jinshan-checkin-staging.pages.dev` 仅用于 Cloudflare 真实环境压力测试。
- 生产 D1 已创建并完成空库结构迁移，活动总开关默认关闭。
- 在“业务 API 对等检查”完成前，禁止把测试 Worker 当作正式业务后端。
- GitHub Actions 的生产部署任务故意设置为失败门禁，避免误上线不完整接口。

## 已创建的 Cloudflare 资源

| 环境 | 资源 | 名称 | ID |
|---|---|---|---|
| 测试 | Pages | `jinshan-checkin-staging` | Pages 项目名 |
| 测试 | D1 | `jinshan-checkin-staging` | `52cce165-851c-45fa-a85b-a68c4f095a6f` |
| 生产 | D1 | `jinshan-checkin-production` | `27e4f2f6-335f-4311-a2d3-88e5a359759e` |
| 测试 | R2 | 待账户启用后创建 | — |
| 生产 | R2 | 待账户启用后创建 | — |

## 首次账户配置

1. 在 Cloudflare 控制台启用 R2。
2. 创建两个私有存储桶：
   - `jinshan-checkin-staging`
   - `jinshan-checkin-production`
3. 不启用公开 `r2.dev` 地址。所有材料读取必须经过鉴权后的 Function。
4. 在 Pages 的生产和预览环境分别绑定：
   - `DB`：对应环境的 D1 数据库
   - `UPLOADS`：对应环境的 R2 存储桶
5. 在 Pages Secrets 中设置：
   - `SESSION_SECRET`：至少 48 字节随机值
   - `LOAD_TEST_SECRET`：只存在于测试环境，压测完成后删除

## 数据库迁移

测试库：

```powershell
wrangler d1 execute jinshan-checkin-staging --remote `
  --file migrations/0001_cloudflare_core.sql
```

生产库：

```powershell
wrangler d1 execute jinshan-checkin-production --remote `
  --file migrations/production/0001_schema.sql
```

生产迁移文件必须满足：

- 可重复执行；
- 所有用户输入均使用 D1 `bind()` 参数绑定；
- 先备份、后迁移；
- 迁移完成后活动开关仍保持关闭；
- 管理员账号通过单独的受控导入创建，不能提交到 Git。

## GitHub 自动部署

工作流文件为 `.github/workflows/cloudflare.yml`。

在 GitHub 仓库的 Actions Secrets 中添加：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

API Token 只授予本项目所需的 Pages、Workers、D1、R2 编辑权限，不使用
Global API Key。`main` 分支推送会在测试通过后自动部署测试环境。

生产环境使用 GitHub Environment `cloudflare-production`，应启用人工审批。
业务 API 对等检查完成后，才可以把生产门禁步骤替换为正式 Pages 部署命令。

## 业务 API 对等检查

解除生产门禁前，必须确认以下现有接口全部迁移到 D1/R2：

- 登录、会话过期、账号禁用；
- 用户、队伍、队长和批量导入；
- 任务、个人打卡、队伍打卡、草稿、审核；
- R2 图片及后期材料的上传、鉴权下载和删除；
- 广场、点赞、浏览去重；
- 日榜、月榜、冻结和导出；
- 管理员数据看板、审核、Excel 导出；
- 活动总开关和单赛道开关；
- 所有管理员接口的服务端权限校验。

## 域名绑定

生产部署通过后：

1. 打开 Cloudflare Pages 项目。
2. 进入“Custom domains / 自定义域”。
3. 添加活动域名。
4. 如果域名也在当前 Cloudflare 账号，DNS 可自动配置；否则按页面提供的
   CNAME/验证记录在域名服务商处添加。
5. 等待证书状态为 Active 后，再向参与者发布地址。

## 数据备份

D1 导出：

```powershell
wrangler d1 export jinshan-checkin-production --remote `
  --output backups/jinshan-checkin-YYYYMMDD.sql
```

备份文件包含姓名、学号和活动记录，必须保存到受控位置，不得提交 Git。

R2 建议使用独立备份桶或 S3 兼容工具进行对象同步。数据库中的对象键和 R2
对象必须作为同一批次备份。活动期间每天备份一次，关键截止日增加一次备份。

## 故障恢复

1. 立即关闭 `activityEnabled`，阻止新提交。
2. 保留 Pages 当前版本，不覆盖现场证据。
3. 从 Cloudflare 部署历史回滚到上一稳定版本。
4. 新建恢复用 D1，导入最近备份，核对用户数、提交数和对象键数量。
5. 将预览环境绑定到恢复库进行抽样验证。
6. 验证通过后切换生产绑定，再重新开启活动。

不要在损坏的生产库上直接反复执行修复脚本。

## 微信真实设备验收

正式发布前至少完成：

- Android 微信：登录、相册权限、拍照、选择多图、压缩、上传、返回页面；
- iOS 微信：登录、相册有限权限、HEIC/转换提示、后台返回、上传失败恢复；
- 平板及电脑微信内置浏览器；
- 页面返回后草稿和已选图片状态；
- 5MB 边界、8 张最终证明边界、异常格式和权限拒绝；
- 校园网与移动网络各测试一次。

UA 模拟只能检查布局，不能代替真实微信 WebView 验收。
