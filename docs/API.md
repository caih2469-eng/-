# 当前 API 说明

服务默认监听 `http://localhost:3000`。请求和响应均为 JSON，图片通过 Base64 Data URL 包含在提交 JSON 中。

## 认证

登录后返回 `Authorization: Bearer <token>` 使用的令牌。当前令牌只是 Base64 编码的用户 ID，不安全、不可用于生产环境。

## 公共接口

### `POST /api/login`

请求：

```json
{"studentId":"admin","password":"change-me-now"}
```

成功返回令牌、安全用户资料、活动配置和双赛道列表。禁用账号返回 403。登录方式和令牌格式仍沿用现有系统。

## 已登录用户

### `GET /api/me`

返回当前用户自己的只读资料、配置、双赛道列表、上海时区日期和时间。响应不包含密码。

### `GET /api/checkins?date=YYYY-MM-DD`

返回当前用户指定日期的打卡记录。学生只能读取自己的记录。

### `POST /api/checkins`

仅学生可用。请求包含：

```json
{
  "slotId": "breakfast",
  "date": "2026-09-12",
  "photos": ["data:image/jpeg;base64,..."],
  "summary": "data:image/png;base64,...",
  "note": "可选备注"
}
```

服务端要求：

- 日期必须是上海时区当天。
- 当前时间必须处于对应时段。
- 至少一张餐食图片。
- 请求文本上限约 25 MB。

同一用户、日期、时段再次提交会替换记录，但旧文件不会删除。

## 管理员接口

所有 `/api/admin/*` 接口要求 `role === "admin"`。

### `GET /api/admin/dashboard?date=YYYY-MM-DD`

返回配置及全部学生在指定日期的时段记录。当前使用对象展开返回完整学生记录，包含明文密码，必须在上线前修复。

### `GET /api/admin/users`

返回全部普通用户的安全资料及赛道列表，不包含密码。

### `POST /api/admin/users`

创建学生：

```json
{
  "studentId": "学号",
  "name": "姓名",
  "password": "初始密码",
  "campus": "校区",
  "trackId": "health",
  "status": "active"
}
```

服务端验证姓名、学号、校区、赛道、状态、初始密码和学号唯一性。

### `PUT /api/admin/users/:id`

管理员编辑普通用户的姓名、学号、校区、所属赛道和账号状态，可选重置密码。角色和创建时间不可修改。

### `PATCH /api/admin/users/:id/status`

请求：

```json
{"status":"disabled"}
```

只接受 `active` 或 `disabled`。禁用后旧令牌立即失效。

### `POST /api/admin/users/import`

上传 Base64 编码的 `.xlsx`。首行必须包含“姓名、学号、校区、所属赛道、初始密码”，可选“账号状态”。服务端整批校验；任一行错误则不写入任何用户。

### `PUT /api/admin/config`

将请求体浅合并到当前配置。当前没有严格 schema 校验。

### `PUT /api/admin/checkins/:id`

请求：

```json
{"status":"approved","reviewNote":"可选"}
```

除 `approved` 外的状态都会保存为 `rejected`。

## 静态文件

- `/`、`/app.js`、`/style.css` 来自 `public/`
- `/uploads/:filename` 直接返回图片，没有登录或权限检查

## 建议的 API 演进

- API 永不返回密码哈希或其他认证材料。
- 使用签名会话和 HttpOnly Cookie。
- 为请求/响应增加 schema 校验和一致错误码。
- 上传改为受鉴权的 multipart 或 R2 直传流程。
- 图片读取必须验证当前用户是文件所有者或管理员。
- 管理员操作写入审计日志。
- 明确定义分页、批量导入、导出和异常重试行为。
