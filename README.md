# 廿载同心·青春同行打卡网站

这是当前已有的本地原型：包含活动宣传页、学生登录、双赛道身份资料、分时段截图打卡和管理员总览。它可以在单台 Windows 电脑上运行，但尚不具备公开互联网部署所需的完整安全性、并发存储和 Cloudflare 配置。

## 当前技术栈

- Node.js 原生 `http` 服务
- 原生 HTML、CSS、JavaScript 单页前端
- ExcelJS 负责服务端解析 `.xlsx` 名单
- 本地 JSON 文件数据库：`data/db.json`
- 本地图片目录：`uploads/`
- GitHub 默认分支：`main`
- 使用 Node.js 内置测试框架进行接口和权限测试
- 无 Cloudflare Workers/Pages、D1、R2、Wrangler 或 GitHub Actions 配置

## 本地启动

首次使用先安装依赖：

```powershell
pnpm install
```

Windows 用户随后可双击 `启动打卡网站.cmd`，或运行：

```powershell
node server.js
```

随后打开 `http://localhost:3000`。

当前代码内置原型管理员账号 `admin` 和默认密码 `change-me-now`。该凭据仅适合本地演示；当前版本没有修改密码功能，不应直接公开部署。

## 页面和功能

- 未登录：双赛道宣传页和现有登录入口
- 学生：只读查看姓名、学号、校区、所属赛道、账号状态和创建时间
- 自律健康赛道学生：查看当天三个时段、提交或更新截图
- 四校区互动赛道学生：查看个人赛道身份和活动提示
- 管理员：用户列表、添加/编辑/禁用用户、Excel 导入、提交审核和时段设置

## 数据位置

- `data/db.json`：配置、用户和打卡记录
- `uploads/`：上传图片

这两个目录已被 `.gitignore` 排除。不要把真实学号、密码或活动材料提交到 GitHub。

## 项目文档

- [项目现状与后续计划](docs/PROJECT_PLAN.md)
- [数据库说明](docs/DATABASE.md)
- [API 说明](docs/API.md)
- [测试与检查结果](docs/TESTING.md)

## 重要限制

当前认证令牌未签名、密码明文保存、上传图片可直接访问、文件数据库不支持可靠并发。正式上线前必须先完成 `docs/PROJECT_PLAN.md` 中的安全和 Cloudflare 数据层改造。
