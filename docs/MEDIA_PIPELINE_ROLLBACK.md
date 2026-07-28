# 测试环境图片链路回滚

本次重构只允许先部署到 `jinshan20-test`。测试通过并经真机验收前，不覆盖正式站。

## 切回旧测试部署

在 Cloudflare Pages 的 `jinshan20-test` 项目中，选择重构前、来源提交为
`26155a0f289aa1b61721685c89fb61356164e8f8` 的部署并执行回滚。

## 关闭 R2 直传

前端与 Functions 必须作为一个版本一起回滚。不能只删除 R2 S3 凭据却保留新前端，
否则用户申请上传地址时会收到“环境未配置”错误。

## 回滚测试 D1

仅在确认新表中没有需要保留的测试媒资后执行：

```powershell
npx wrangler d1 execute jinshan20-test --remote --file migrations/production/0006_media_pipeline.rollback.sql
```

该脚本只删除新增的 `media_upload_intents`、`media_objects` 及其索引，不删除历史图片表。

## 清理未确认对象

先查询测试 D1 中状态为 `pending`、`expired`、`rejected` 的上传意图，逐个确认
`object_key` 以 `media/test/` 开头后，再从 `jinshan20-test` R2 删除。禁止通配删除，
也不得对正式 Bucket 执行该操作。

## 源码恢复点

- 安全快照分支：`backup/pre-media-rebuild-20260727`
- 重构起点：`26155a0f289aa1b61721685c89fb61356164e8f8`
- 媒体重构提交：`799b5a4`
- 管理端按需加载提交：`d46a1de`

旧前端资源随 Pages 部署一起恢复，不需要覆盖 `main`。
