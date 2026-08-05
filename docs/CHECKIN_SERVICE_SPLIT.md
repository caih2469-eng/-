# 打卡独立 Worker 分阶段上线

## 第一阶段：部署但不切流

第一阶段创建并部署 `jinshan20-checkin` 和 `jinshan20-checkin-test`，但不在 Pages 中声明 `CHECKIN_SERVICE`。线上请求继续由主 Worker 的原始学生路由处理。

独立服务仅接收以下内部路由：

- `GET /api/checkins`
- `POST /api/checkins`
- `GET /api/checkins/history`
- `PUT /api/tasks/:id/member-checkin`
- `GET /api/checkin-service-health`，仅用于内部绑定验收

媒体上传、私有图片读取、公共图片、普通任务提交和活动广场继续留在主 Worker。

## 安全边界

- 子 Worker 设置 `workers_dev: false`，不公开 `workers.dev` 地址。
- 必须提供由主 Worker 写入的内部服务标识。
- 正常打卡接口还必须携带主 Worker生成的最小用户信息。
- 主 Worker会删除客户端伪造的内部请求头，再写入可信值。
- 读取请求在 Service Binding异常时可以回退原路由。
- 写入请求失败时返回503，禁止自动重试，避免重复打卡。
- 原学生路由完整保留，可通过删除 Service Binding立即回滚。

## 资源和秘密

子 Worker绑定对应环境的D1和R2资源，并要求存在 `MEDIA_SIGNING_SECRET`。该密钥用于为打卡列表和历史记录生成私有图片地址，因此必须与接收 `/api/private-media/*` 请求的同环境Pages项目使用相同值。

生产环境必须保持一致：

- Pages项目 `jinshan20`
- Worker `jinshan20-checkin`

测试环境必须保持一致：

- Pages项目 `jinshan20-test`
- Worker `jinshan20-checkin-test`

密钥值不得写入仓库、日志、PR描述或聊天。无法读取旧密钥时，应同时轮换同一环境中的Pages和Worker密钥；生产和测试可以使用不同值。

验收时主Worker生成一次随机挑战，子Worker使用自身密钥计算不可逆HMAC，主Worker再使用Pages密钥校验。证明值仅通过内部Service Binding传递，并在返回公网前删除。公网健康结果只显示：

- `mediaSigning: true`：子Worker存在密钥；
- `mediaSigningAligned: true`：Pages与子Worker密钥值一致。

缺少D1、R2、媒体签名密钥或两边密钥不一致时，健康检查返回503并阻止生产验收。

## 第二阶段：切换Service Binding

第二阶段在Pages配置中加入：

```json
{
  "binding": "CHECKIN_SERVICE",
  "service": "jinshan20-checkin"
}
```

测试环境绑定 `jinshan20-checkin-test`，不得连接生产服务。

生产发布完成后，工作流请求 `/api/checkin-service-health`，必须同时满足：

- HTTP 200
- `x-jinshan-service: checkin`
- `x-jinshan-service-version: checkin-v1`
- `ok: true`
- `mediaSigning: true`
- `mediaSigningAligned: true`

验证成功后发布提交状态 `checkin-binding/production-smoke`。

## 回滚

从生产Pages配置删除 `CHECKIN_SERVICE` binding并重新发布，即可恢复主 Worker本地路由。回滚不会删除独立Worker、D1数据或R2对象，也不执行破坏性迁移。
