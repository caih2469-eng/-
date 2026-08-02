from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "Excel 云端自动汇总"
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
JOB_ROOT = Path(os.getenv("JOB_ROOT", "/tmp/excel-cloud-merger/jobs"))
JOB_ROOT.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
MAX_ZIP_UNCOMPRESSED_BYTES = int(
    os.getenv("MAX_ZIP_UNCOMPRESSED_BYTES", str(200 * 1024 * 1024))
)
MAX_ZIP_ENTRIES = int(os.getenv("MAX_ZIP_ENTRIES", "200"))
JOB_TTL_MINUTES = int(os.getenv("JOB_TTL_MINUTES", "30"))
APP_ACCESS_KEY = os.getenv("APP_ACCESS_KEY", "").strip()

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".zip"}
EXCEL_EXTENSIONS = {".xlsx", ".xls", ".csv"}

FIELD_ALIASES: dict[str, set[str]] = {
    "学号": {"学号", "学生学号", "学籍号", "studentid", "studentno", "idno", "学号必填"},
    "姓名": {"姓名", "学生姓名", "名字", "name", "学生名字", "姓名必填", "参赛人姓名"},
    "专业": {"专业", "所属专业", "专业名称", "major", "就读专业"},
    "班级": {"班级", "所在班级", "行政班", "class", "班级名称"},
    "学院": {"学院", "所属学院", "院系", "college", "department"},
    "校区": {"校区", "所在校区", "campus"},
    "联系电话": {"联系电话", "手机号", "手机号码", "电话", "联系方式", "mobile", "phone"},
    "身份证号": {"身份证号", "身份证号码", "证件号码", "idcard", "identitynumber"},
    "性别": {"性别", "gender"},
    "状态": {"状态", "报名状态", "审核状态", "提交状态", "status"},
    "备注": {"备注", "说明", "remark", "comments"},
}
