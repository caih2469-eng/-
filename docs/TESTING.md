# 测试与检查

## 2026-07-24 审计结果

## 阶段 1 自动测试

运行：

```powershell
node --test
```

结果：2 个测试通过，0 个失败。覆盖：

- 旧数据库迁移和两个赛道初始化。
- 管理员沿用现有登录流程登录。
- 登录和资料接口不返回密码。
- 管理员添加、编辑、禁用/启用用户。
- 普通用户只能查看自己的资料。
- 普通用户访问用户列表或编辑接口返回 403。
- Excel `.xlsx` 名单导入。
- 禁用账号的已有令牌失效，且不能重新登录。

### 已运行

| 检查 | 结果 |
| --- | --- |
| `node --check server.js` | 通过 |
| `node --check public/app.js` | 通过 |
| 解析 `data/db.json` | 通过 |
| 启动 `node server.js` | 通过 |
| `GET /` | HTTP 200 |
| 管理员 `POST /api/login` | 通过 |
| 带令牌 `GET /api/me` | 通过，角色为 `admin`，配置含 3 个时段 |
| Git 工作区与远端 | `main` 跟踪 `origin/main` |
| GitHub Actions | 0 个工作流 |
| GitHub Pages | 未配置 |

### 无法运行

| 检查 | 原因 |
| --- | --- |
| lint | 有 `package.json`，但尚未引入 ESLint |
| 类型检查 | 项目是原生 JavaScript，没有 TypeScript/JSDoc 类型检查配置 |
| 构建 | 静态资源直接提供，没有构建工具或 build 脚本 |
| 自动化测试 | 已使用 Node.js 内置测试框架 |
| Cloudflare 构建/预览 | 没有 Wrangler 或任何 Cloudflare 配置 |

“无法运行”表示对应工具链不存在，不表示这些检查通过。

## 当前手动验证命令

```powershell
node --check server.js
node --check public/app.js
node -e "JSON.parse(require('fs').readFileSync('data/db.json','utf8'))"
node server.js
```

启动后至少验证：

1. `GET /` 返回 200。
2. 错误密码返回 401。
3. 管理员登录后能读取 `/api/me` 和 `/api/admin/dashboard`。
4. 学生不能调用管理员接口。
5. 非当前日期和时段外打卡被拒绝。
6. 同一时段更新只保留一条逻辑记录。
7. 管理员通过/驳回状态能正确显示。

## 建议的自动化测试范围

### API

- 登录成功、失败、限流和会话过期。
- 角色权限矩阵。
- 活动起止日期和时段边界：前一秒、起始、结束、后一秒。
- 重复提交、并发提交、文件失败和数据库回滚。
- 审核状态转换和审计日志。

### 安全

- 令牌伪造、越权读取、路径遍历、上传 MIME 欺骗。
- XSS、恶意配置值、超大请求和暴力登录。
- 确认所有响应不包含密码或密码哈希。
- 确认上传对象未登录无法读取。

### 前端

- 宣传页、登录、学生三时段、管理员表格的移动端布局。
- 配置变更后所有页面文案和时段一致。
- `pending`、`approved`、`rejected` 三种状态显示。

### 部署

- GitHub Actions 运行 lint、类型检查、测试和构建。
- Cloudflare 预览环境验证 D1 migrations、R2 bindings 和 secrets。
- 生产部署前执行备份、回滚和隐私验收。
