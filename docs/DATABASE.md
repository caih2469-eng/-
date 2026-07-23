# 数据库与存储说明

## 当前实现

当前没有数据库服务。`server.js` 将整个 `data/db.json` 读入内存、修改后再整体写回文件；图片则写入 `uploads/`。

```text
db.json
├─ config
│  ├─ activityName
│  ├─ startDate
│  ├─ endDate
│  └─ slots[]
├─ users[]
├─ tracks[]
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
