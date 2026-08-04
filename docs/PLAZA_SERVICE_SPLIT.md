# 活动广场独立 Worker 分阶段切换

## 目标

把活动广场列表、详情、评论、点赞、浏览量、消息和排行的业务执行从主 Pages Function 拆到独立 Worker，同时保持前端页面、登录方式和 `/api/...` 地址不变。

公开图片仍由现有 `/api/public-images/*` 媒体链路提供，避免重复图片鉴权、缓存和 R2 读取代码。

## 第一阶段：预部署，不切流量

本阶段部署：

- `jinshan20-plaza-test`
- `jinshan20-plaza`

Pages 项目暂不配置 `PLAZA_SERVICE`。主 Worker 中的新转发代码只有在绑定存在时才会执行；未配置绑定时继续使用原 `handlePlazaRoutes`。

因此本阶段合并不会改变正式用户请求路径。

## 第二阶段：启用 Service Binding

确认独立 Worker 部署成功后，在 Pages Wrangler 配置中加入：

```json
{
  "services": [
    {
      "binding": "PLAZA_SERVICE",
      "service": "jinshan20-plaza"
    }
  ]
}
```

测试站绑定 `jinshan20-plaza-test`。

主 Worker 先完成现有登录认证，再通过内部请求头传递最小用户上下文：用户 ID、角色、赛道和状态。独立 Worker 关闭 `workers.dev`，不提供公开地址。

## 回退规则

1. 删除 Pages 配置中的 `PLAZA_SERVICE` binding 并重新部署 Pages。
2. 主 Worker 会自动恢复原本地 `handlePlazaRoutes`，不需要回滚数据库或前端。
3. 独立 Worker 可保留，不会接收流量；也可单独删除。

读取请求在 Service Binding 抛出网络级异常时允许回退本地路由。写请求不自动重试或回退，避免评论、点赞等操作重复执行。

## 数据与图片

- 独立 Worker 绑定原 D1，不复制数据。
- 不新增或迁移数据库表。
- 图片继续使用原 R2 和公开图片接口。
- 前端缩略图和高清图质量参数不变。
