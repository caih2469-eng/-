# Cloudflare 上线部署说明

## 当前双环境

本项目不购买域名、不配置 DNS，只使用 Cloudflare Pages 默认域名。

| 项目 | Git 分支 | Pages 地址 | D1 | R2 | Cloudflare 环境变量 |
|---|---|---|---|---|---|
| 测试 | `develop` | `https://jinshan20-test.pages.dev` | `jinshan20-test` | `jinshan20-test` | `ENVIRONMENT=test`、`PROJECT_NAME=jinshan20-test` |
| 正式 | `main` | `https://jinshan20.pages.dev` | `jinshan20` | `jinshan20` | `ENVIRONMENT=production`、`PROJECT_NAME=jinshan20` |

两套环境各自使用独立的 `SESSION_SECRET`，D1 ID 和 R2 桶名没有复用。
`ALLOW_LOAD_TESTS=false`，正式和测试地址均拒绝压力测试专用上传接口。
生产 D1 当前为空，活动总开关和两个赛道开关均为关闭状态。

对应配置文件：

- `cloudflare/pages-test/wrangler.jsonc`
- `cloudflare/pages-production/wrangler.jsonc`

## 自动部署流程

1. 开发改动先提交到 `develop`。
2. GitHub Actions 执行语法检查和 21 项自动测试。
3. 测试通过后，只把 `develop` 部署到 `jinshan20-test`。
4. 测试环境人工验收通过后，把同一提交合并到 `main`。
5. `main` 再次通过全部检查后，只部署到 `jinshan20`。

GitHub 环境也设置了分支限制：

- `cloudflare-test` 只接受 `develop`；
- `cloudflare-production` 只接受 `main`。

仓库必须设置 `CLOUDFLARE_ACCOUNT_ID` 和最小权限
`CLOUDFLARE_API_TOKEN`。账号 ID 已配置；API Token 必须由 Cloudflare
账号持有人在控制台创建，因为 Wrangler OAuth 无权代替用户创建长期 API Token。

## 回滚

Pages 回滚不改数据库：

1. 打开对应 Pages 项目的 **Deployments / 部署**。
2. 找到最近一个已验证的成功版本。
3. 选择 **Rollback to this deployment / 回滚到此部署**。
4. 回滚后检查 `/health` 的 `environment`、`project`、`database` 和 `storage`。

数据故障时不要把测试库切给正式站。应先关闭活动开关，导出当前正式 D1，
再从正式环境自己的备份恢复到一个新的正式恢复库，验证后更换正式绑定。
R2 恢复也只允许从正式备份恢复到 `jinshan20`，禁止从 `jinshan20-test` 复制。

## 当前状态

本仓库的公开前端仍是静态 HTML/CSS/JavaScript，原业务后端仍是 Node.js +
JSON 文件。上线前测试已增加隔离的 Cloudflare Pages Functions、D1 和 R2
适配层，但它目前只覆盖登录、用户读取、任务读取、排行榜及压力测试上传。

因此，两个 Pages 地址已经创建并部署，但正式环境保持活动关闭。在完整业务
API 迁移和微信实体设备验收完成前，不向参与者发放正式账号。

## 已创建的 Cloudflare 资源

| 环境 | 资源 | 名称 | ID |
|---|---|---|---|
| 测试 | Pages | `jinshan20-test` | `jinshan20-test.pages.dev` |
| 测试 | D1 | `jinshan20-test` | `6d217199-0c06-45a3-8bdc-e32c36140957` |
| 正式 | Pages | `jinshan20` | `jinshan20.pages.dev` |
| 正式 | D1 | `jinshan20` | `1734a812-afc8-4c49-a1f1-f776c4b7ae69` |
| 测试 | R2 | `jinshan20-test` | 私有桶 |
| 正式 | R2 | `jinshan20` | 私有桶 |

## 首次账户配置

1. 当前账号已启用 R2，并已创建两个私有存储桶：
   - `jinshan20-test`
   - `jinshan20`
3. 不启用公开 `r2.dev` 地址。所有材料读取必须经过鉴权后的 Function。
4. 在 Pages 的生产和预览环境分别绑定：
   - `DB`：对应环境的 D1 数据库
   - `UPLOADS`：对应环境的 R2 存储桶
5. 在 Pages Secrets 中设置：
   - `SESSION_SECRET`：至少 48 字节随机值
   - `LOAD_TEST_SECRET`：仅在执行隔离压测时临时创建，压测完成后立即删除

当前测试项目仅保留 `SESSION_SECRET`；压测密钥和 3.5GB 合成对象已清理。

## 数据库迁移

测试库：

```powershell
wrangler d1 execute jinshan20-test --remote `
  --file migrations/production/0001_schema.sql
```

生产库：

```powershell
wrangler d1 execute jinshan20 --remote `
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
切换 Cloudflare 账号后，必须同步更新上述两个 GitHub Secrets；OAuth 登录凭据
不能复制为 Actions Token。

正式环境使用 GitHub Environment `cloudflare-production` 并限制为 `main`；
测试环境使用 `cloudflare-test` 并限制为 `develop`。

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
