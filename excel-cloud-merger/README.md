# Excel 云端自动汇总工具

面向手机和电脑浏览器的 Excel/CSV/ZIP 自动汇总工具。上传文件后，程序自动识别表头、统一常见字段、纵向合并、按指定字段去重，并生成多工作表的 `总汇总表.xlsx`。

## 已实现功能

- 支持 `.xlsx`、`.xls`、`.csv`、`.zip`
- 一次上传多个文件
- 自动查找前 30 行中的表头
- 自动统一学号、姓名、专业、班级、学院、校区、联系电话等字段别名
- 按学号、姓名或联系电话去重
- 重复数据优先保留信息更完整的一条
- 输出全部明细、分类统计、重复数据、缺失数据、异常数据和文件处理记录
- 手机响应式网页
- 可选访问密码
- 浏览器完整接收结果后，立即请求删除云端任务目录
- 用户中途退出时，默认 30 分钟后自动清理
- ZIP 路径穿越、符号链接、文件数量和解压大小防护

## 下载后删除逻辑

网页无法确认文件是否最终写入手机系统的“下载”目录，但可以确认文件数据是否已经完整传到浏览器。当前流程为：

1. 浏览器完整接收汇总表数据；
2. 浏览器发起本地下载；
3. 页面调用删除确认接口；
4. 服务器删除原始文件、解压文件、结果文件和任务元数据；
5. 若确认请求因断网或关闭页面失败，TTL 清理任务在默认 30 分钟后删除文件。

## 项目目录

```text
app/
  main.py
  config.py
  security.py
  excel_processor.py
static/
  index.html
  style.css
  app.js
Dockerfile
render.yaml
requirements.txt
```

## 本地运行

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Windows 激活虚拟环境：

```powershell
.venv\Scripts\activate
```

访问：`http://127.0.0.1:8000`

## 环境变量

```text
APP_ACCESS_KEY=访问密码
JOB_TTL_MINUTES=30
MAX_UPLOAD_BYTES=52428800
MAX_ZIP_UNCOMPRESSED_BYTES=209715200
MAX_ZIP_ENTRIES=200
JOB_ROOT=/tmp/excel-cloud-merger/jobs
```

## 新加坡节点：Render

仓库根目录包含 `render.yaml`，服务目录为 `excel-cloud-merger`，区域为 Singapore。

建议设置：

- 单实例运行
- `APP_ACCESS_KEY` 使用强密码
- 不启用持久磁盘
- 健康检查路径 `/api/health`

## 中国大陆节点：腾讯云 CloudBase 云托管

项目包含 `Dockerfile`，可从 GitHub 仓库拉取代码构建。

控制台配置：

```text
代码仓库：caih2469-eng/jinshan20-site
分支：excel-cloud-merger
目标目录：excel-cloud-merger
Dockerfile：Dockerfile
监听端口：80
最小实例：1
最大实例：1
```

环境变量与 Render 保持一致。当前版本使用单实例临时磁盘完成短时任务，因此大陆节点必须固定为一个实例，避免上传、下载和删除请求落到不同容器。

## 隐私与运行限制

- 上传内容可能包含姓名、学号、手机号等个人信息，必须设置访问密码。
- 当前版本适合个人或小团队、低并发使用。
- 不长期保存文件，不作为档案系统使用。
- 若以后需要多实例、高并发，应把临时文件迁移到对象存储，并增加任务队列和共享状态存储。
