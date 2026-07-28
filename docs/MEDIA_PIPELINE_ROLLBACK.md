# 测试环境图片链路回滚

本次重构只允许部署到 `jinshan20-test`。禁止把迁移或测试对象写入正式 D1/R2。

## 切回旧测试部署

在 Cloudflare Pages 的 `jinshan20-test` 项目中选择重构前、来源提交为
`26155a0f289aa1b61721685c89fb61356164e8f8` 的部署并执行回滚。

## 关闭 R2 直传

回滚前端与 Functions 到上述部署后，新上传会恢复旧接口。不要仅删除 R2
S3 密钥而继续运行新前端，否则用户会在申请上传意图时收到环境未配置错误。

## 回滚测试 D1

仅在确认测试表中没有仍需保留的测试媒体后执行：

```powershell
npx wrangler d1 execute jinshan20-test --remote --file migrations/production/0006_media_pipeline.rollback.sql
```

该回滚只删除新增的 `media_upload_intents`、`media_objects` 及其索引，不删除历史图片表。

## 清理未确认对象

先查询测试 D1 中 `pending`、`expired`、`rejected` 的上传意图，逐个核对
`object_key` 均以 `media/test/` 开头后，再从 `jinshan20-test` R2 删除。
禁止用通配路径删除，也不得对正式 Bucket 执行该操作。

## 恢复源码

- 安全快照分支：`backup/pre-media-rebuild-20260727`
- 重构起点：`26155a0f289aa1b61721685c89fb61356164e8f8`
- 工作区改动的额外恢复点：`stash@{0}`

旧前端资源随 Pages 部署一起恢复，不需要覆盖 `main`。
