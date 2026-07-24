# 数据库与存储说明

## 当前实现

当前没有数据库服务。`server.js` 将整个 `data/db.json` 读入内存、修改后再整体写回文件；图片则写入 `uploads/`。

```text
db.json
├─ config
│  ├─ activityName
│  ├─ startDate
│  ├─ endDate
│  ├─ maxTeams
│  └─ slots[]
├─ users[]
├─ tracks[]
├─ teams[]
└─ checkins[]
```

## 当前数据结构

### config

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `activityName` | string | 活动显示名称 |
| `startDate` | `YYYY-MM-DD` | 当前仅保存，服务端未执行 |
| `endDate` | `YYYY-MM-DD` | 当前仅保存，服务端未执行 |
| `slots` | array | 早餐、午餐、晚餐时段 |
| `maxTeams` | integer | 互动赛道最大队伍数量，默认 50，运行时规则读取数据库值 |

每个时段包含 `id`、`label`、`start`、`end`。

### users

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 管理员为固定值，学生为 UUID |
| `studentId` | string | 登录名和唯一性检查依据 |
| `name` | string | 姓名 |
| `password` | string | 当前为明文，生产环境不可接受 |
| `role` | `admin` / `student` | 权限角色 |
| `campus` | string? | 校区 |
| `trackId` | `interaction` / `health` / null | 普通用户所属赛道；管理员为 null |
| `status` | `active` / `disabled` | 账号状态 |
| `createdAt` | ISO datetime | 账号创建时间 |

### tracks

| ID | 名称 |
| --- | --- |
| `interaction` | 四校区互动赛道 |
| `health` | 自律健康赛道 |

赛道由服务端固定定义，并在数据库迁移时写入顶层 `tracks`。

### teams

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 队伍 ID |
| `name` | string | 唯一队伍名称 |
| `memberLimit` | integer | 人数限制，1–20 |
| `inviteCode` | string | 唯一 8 位邀请码 |
| `memberIds` | string[] | 队伍成员用户 ID |
| `createdAt` | ISO datetime | 创建时间 |

成员关系以 `teams[].memberIds` 为唯一来源。服务端遍历所有队伍确保一个学生最多出现一次。

### checkins

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 打卡记录 ID |
| `userId` | string | 关联用户 |
| `date` | `YYYY-MM-DD` | 上海时区日期 |
| `slotId` | string | 时段 ID |
| `photos` | string[] | `/uploads/...` 路径 |
| `summary` | string/null | 汇总截图路径 |
| `note` | string | 最长 300 字符 |
| `submittedAt` | ISO datetime | 服务器提交时间 |
| `status` | string | `pending`、`approved`、`rejected` |
| `reviewNote` | string? | 后端支持但当前界面不提交 |

逻辑唯一键是 `(userId, date, slotId)`，但当前没有数据库约束。

## 当前风险

- 明文密码和健康相关截图属于敏感信息。
- 整文件写入没有事务、锁、索引或并发控制。
- 记录替换不会清理旧图片。
- 没有级联删除、备份、审计、保留期和数据导出。
- 图片 URL 无鉴权。

## 建议的 Cloudflare 模型

### D1 表

- `users(id, student_id, name, password_hash, role, campus, status, created_at, updated_at)`
- `sessions(id, user_id, token_hash, expires_at, revoked_at, created_at)`
- `activity_config(id, activity_name, start_date, end_date, timezone, updated_by, updated_at)`
- `checkin_slots(id, label, start_time, end_time, sort_order, enabled)`
- `checkins(id, user_id, checkin_date, slot_id, note, status, submitted_at, reviewed_by, reviewed_at, review_note)`
- `checkin_files(id, checkin_id, object_key, media_type, byte_size, sha256, kind, created_at)`
- `audit_logs(id, actor_id, action, entity_type, entity_id, metadata_json, created_at)`

关键约束：

- `users.student_id` 唯一。
- `checkins(user_id, checkin_date, slot_id)` 唯一。
- 外键关联用户、时段、审核人和文件。
- 所有日期规则统一使用 `Asia/Shanghai`。

### R2 对象

图片对象键不要包含姓名或完整学号，建议：

```text
checkins/{checkin-id}/{file-id}.{ext}
```

对象保持私有，通过鉴权后的 Worker 返回短时访问响应。数据库只保存对象键和校验信息。

## 数据迁移原则

当前原型数据若需要迁移，应先备份 `db.json` 和 `uploads/`，再通过一次性脚本验证用户、唯一键和文件完整性。真实密码不能原样迁移，应要求用户重置密码。

阶段 1 迁移脚本为 `migrations/001-user-profiles-and-tracks.js`。它会：

1. 备份现有 `db.json`。
2. 写入两个赛道。
3. 为旧用户补齐 `campus`、`trackId`、`status` 和 `createdAt`。
4. 将旧普通用户默认归入自律健康赛道，管理员不属于任何赛道。

阶段 2 迁移脚本为 `migrations/002-team-system.js`。它会：

1. 在迁移前备份现有数据库。
2. 将 `config.maxTeams` 初始化为 50。
3. 创建空的顶层 `teams` 集合。
4. 重复执行时保持数据不变。

阶段 3 迁移新增 `tasks[]`、`config.activityEnabled` 和 `config.trackEnabled`。任务包含名称、描述、赛道、起止时间、补交开关、图片上限、文案要求、状态及审计时间。

阶段 4 迁移新增 `taskSubmissions[]`。业务唯一键为 `(taskId, ownerType, ownerId)`，`ownerType` 为 `team` 或 `user`；记录只保存图片 URL、文案、餐次、公开选择、提交/审核状态和并发控制 `version`，不保存图片二进制。

阶段 5 迁移新增 `plazaPosts[]`。帖子通过 `submissionId` 唯一关联公开队伍提交，保存任务/队伍/成员快照、图片 URL、文案、发布时间、`viewCount`、`likedBy[]` 和 `status`。帖子只能由服务端在符合条件的最终提交事务中生成。

阶段 6 迁移新增：

- `plazaLikes[]`：`postId`、`userId`、`likedAt`，保存时强制 `(postId,userId)` 唯一；每日额度按上海日期统计当前有效记录。
- `plazaViews[]`：`postId`、`userId`、`windowStartedAt`、`viewedAt`，保存时强制窗口组合键唯一；服务端读取最近记录执行 24 小时去重。

旧 `likedBy[]` 在迁移时转换为独立点赞记录，后续统计只以 `plazaLikes[]` 为准。

阶段 7 迁移新增 `rankingFreezes[]`，并为帖子补齐 `excludedFromRanking`。冻结记录保存月份、完整排行榜快照、冻结管理员和时间；实时统计使用 `plazaLikes[].likedAt`、`plazaViews[].viewedAt` 和 `plazaPosts[].publishedAt` 的上海时区周期。

阶段 9 迁移新增 `materialTasks[]` 和 `materialSubmissions[]`。任务保存截止时间、扩展名白名单、文件上限、总结要求及个人/队伍模式；提交使用 `(taskId, ownerType, ownerId)` 作为业务唯一关系并包含 `version`。数据库仅保存文件元数据和私有存储名，文件二进制位于 `material-files/`。

任务日程迁移为 `tasks[]` 增加 `scheduleType`、活动日期范围、`refreshDays[]`、`weekdays[]`、每日时间范围；`taskSubmissions[]` 增加 `occurrenceDate` 和 `plazaCopy`。周期任务唯一关系扩展为 `(taskId, ownerType, ownerId, occurrenceDate)`。`config.allowSelfJoin` 默认 `false`。
