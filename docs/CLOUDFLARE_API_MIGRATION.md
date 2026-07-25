# Cloudflare 全业务 API 迁移记录

更新时间：2026-07-25

## 当前状态

测试环境 `https://jinshan20-test.pages.dev` 已将现有业务路由迁移到 Pages Functions。

- 所有结构化数据读取和写入使用 D1，不再读取 `data/db.json`。
- 打卡图片、任务图片和最终截图证明使用私有 R2。
- 客户端只拿到受鉴权的 `/api/files/:id` 或 `/api/material-files/:id`。
- 普通用户只能读取自己的个人文件、所属队伍文件或已公开的广场文件。
- 所有 `/api/admin/*` 路由在服务端验证管理员角色。
- Excel 导入和导出运行在 Workers `nodejs_compat` 环境，学号列强制为文本。

## D1 迁移

测试数据库 `jinshan20-test` 已依次执行：

1. `migrations/production/0001_schema.sql`
2. `migrations/production/0002_business_api.sql`
3. `migrations/production/0003_concurrency_and_file_metadata.sql`

新增内容包括：

- `task_submissions.meal_type`
- `material_submissions.version`
- `member_checkins.content_type`、`member_checkins.bytes`
- `checkins`、`checkin_files`
- `login_attempts`、`idempotency_keys`、`audit_logs`
- 任务窗口、提交状态、材料文件、点赞用户时间和浏览窗口索引

正式 D1 尚未执行 0002 和 0003。

## 并发与事务策略

- 任务提交和材料退回后重提使用 `version` 乐观并发控制；旧版本返回 `409`。
- 更新请求先用带版本条件的 D1 写入抢占修改权，成功者才替换 R2 文件元数据。
- 新建提交依赖 D1 唯一键阻止重复所有者、任务和日期组合。
- 队伍加入把容量判断放在同一条 `INSERT ... SELECT` 中，并由 `team_members.user_id` 唯一键保证一人一队。
- 点赞额度、24 小时浏览去重和广场自动发帖使用 D1 条件写入或 `DB.batch()`。
- R2 上传失败会删除本次已上传对象；数据库写入失败也会清理新对象。

## 已验证

- Pages Functions 编译通过，包含 ExcelJS。
- 本地回归测试 21/21 通过。
- 测试 D1 的 0002 和 0003 迁移通过。
- 管理员登录及 PBKDF2 100000 次哈希通过。
- `/api/me`、后台看板、用户、队伍、任务、材料、广场、排行榜均返回 200。
- 学生访问管理员接口返回 403。
- 匿名读取私有 R2 文件返回 401。
- 真实 R2 图片上传、鉴权读取及媒体类型保留通过。
- 个人任务最终提交通过，重复最终提交返回 409。
- 最终截图任务可按现有前端字段创建；提交、下载、重复提交保护通过。
- 用户名单和材料未交名单均能导出为 `.xlsx`。

## 尚未执行

- 未将本轮迁移应用到正式 D1/R2。
- 未发布正式站。
- 未执行 700 人真实 D1/R2 压力测试。
- 测试库中包含本轮自动冒烟测试数据，上正式库前不会复制这些数据。
