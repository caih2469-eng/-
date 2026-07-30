# 中文编码审计

## 审计范围

本轮以严格 UTF-8 解码扫描仓库内的 JavaScript、JSON、Markdown、HTML、CSS、
SQL、YAML、CMD、TXT 和 Python 文件。排除依赖目录、Git 元数据、本地上传目录及
Wrangler 临时状态。扫描同时检查 Unicode 替换字符、两类常见中文乱码串和连续
问号替换串。

## 发现与修复

| 文件或数据源 | 位置 | 当前文本或编码 | 正确文本或编码 | 可执行 | 用户可见 |
| --- | --- | --- | --- | --- | --- |
| `docs/PERFORMANCE_ACCEPTANCE_REPORT.md` | 原第 159 行 | 连续四个问号的示例 | “连续问号替换串” | 否 | 否 |
| `reports/cloudflare-700-read-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/cloudflare-700-upload-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/cloudflare-file-700-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/cloudflare-instant-700-tasks-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/cloudflare-like-700-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/cloudflare-near-5mb-upload-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| `reports/live-device-performance-2026-07-26.json` | 整个文件 | UTF-16LE | UTF-8 | 否 | 否 |
| 测试 D1 `users.name` | `loadtest-health` | 六个问号 | 健康压测用户 | 否 | 是 |
| 测试 D1 `users.name` | `team-1784955265835-1` | 两个问号加 1 | 队员1 | 否 | 是 |
| 测试 D1 `users.name` | `team-1784955265835-2` | 两个问号加 2 | 队员2 | 否 | 是 |
| 测试 D1 `users.name` | `team-1784955265835-3` | 两个问号加 3 | 队员3 | 否 | 是 |
| 测试 D1 `users.name` | `team-1784955265835-4` | 两个问号加 4 | 队员4 | 否 | 是 |
| 测试 D1 `users.campus` | 上述 5 个测试用户及 `admin-test` | 四个问号 | 测试校区 | 否 | 是 |
| 测试 D1 `tasks.name` | `f90d6e79-56ac-42ea-a16b-65a56d904b1f` | 九个问号 | 健康饮食周期任务 | 否 | 是 |
| 测试 D1 `tasks.description` | 同上 | 四个问号 | 三餐打卡 | 否 | 是 |
| 测试 D1 `tasks.copy_requirement` | 同上 | 两个问号 | 说明 | 否 | 是 |

仓库可执行源码、学生页面、管理员页面和错误提示中没有发现上述乱码字符。
测试 D1 的问号串属于早期测试数据写入时的不可逆字符丢失，无法从字节恢复；
本轮只在测试 D1 中改为明确的测试文案，未读取或修改正式 D1。

## 自动防回归

- `npm run check:text`：严格解码并扫描整个仓库文本。
- `test/text-encoding.test.js`：确保主要页面、管理页面和错误提示不存在乱码替换串。
- 新增文本文件必须保存为 UTF-8。
