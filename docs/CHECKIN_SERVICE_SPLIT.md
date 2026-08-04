# 打卡独立 Worker 分阶段上线

## 第一阶段：部署但不切流

本阶段创建 `jinshan20-checkin` 和 `jinshan20-checkin-test`，但 Pages 配置不声明 `CHECKIN_SERVICE`。因此线上请求仍由主 Worker 的原始学生路由处理。

独立服务仅接收以下内部路由：

- `GET /api/checkins`
- `POST /api/checkins`
- `GET /api/checkins/history`
- `PUT /api/tasks/:id/member-checkin`

媒体上传、私有图片读取、公共图片、普通任务提交和活动广场仍留在主 Worker。

## 安全边界

- 子 Worker 设置 `workers_dev: false`，不公开 `workers.dev` 地址。
- 必须同时提供内部服务标识和主 Worker生成的最小用户信息。
- 主 Worker删除客户端伪造的内部请求头后再写入可信值。
- 读取请求在 Service Binding异常时可以回退原路由。
- 写入请求失败时返回503，禁止自动重试，避免重复打卡。

## 资源和秘密

子 Worker绑定与对应环境相同的 D1和R2资源。正式切流前必须完成：

1. `cloudflare-production` API Token具有 `Account / Workers R2 Storage / Edit`。
2. 子 Worker配置与主站相同的 `MEDIA_SIGNING_SECRET`，用于生成私有历史图片地址。
3. 通过运行时契约测试验证D1读取、R2删除和私有媒体签名。

秘密不得写入仓库、日志或PR描述。

## 第二阶段：单独切流

只有第一阶段部署、权限和契约验证全部通过后，才在独立PR中加入：

```json
{
  "binding": "CHECKIN_SERVICE",
  "service": "jinshan20-checkin"
}
```

测试环境必须绑定 `jinshan20-checkin-test`，不得连接生产服务。

## 回滚

删除 Pages中的 `CHECKIN_SERVICE` binding即可立即恢复主 Worker本地路由。第一阶段不会删除原路由、数据库、R2对象或旧 Worker。
