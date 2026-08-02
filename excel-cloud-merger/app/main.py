from __future__ import annotations

import asyncio
import json
import secrets
import shutil
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_ACCESS_KEY, APP_NAME, JOB_ROOT, JOB_TTL_MINUTES, STATIC_DIR
from .excel_processor import process_files
from .security import save_uploads


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def job_dir(job_id: str) -> Path:
    if not job_id.isalnum() or len(job_id) > 64:
        raise HTTPException(status_code=400, detail="任务编号无效")
    return JOB_ROOT / job_id


def read_meta(directory: Path) -> dict:
    path = directory / "metadata.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="任务不存在或已被删除")
    return json.loads(path.read_text(encoding="utf-8"))


def write_meta(directory: Path, data: dict) -> None:
    (directory / "metadata.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def remove_job(directory: Path) -> None:
    shutil.rmtree(directory, ignore_errors=True)


def verify_access_key(x_access_key: str | None) -> None:
    if APP_ACCESS_KEY and not secrets.compare_digest(x_access_key or "", APP_ACCESS_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="访问密码错误")


async def cleanup_expired_jobs() -> None:
    while True:
        cutoff = utc_now() - timedelta(minutes=JOB_TTL_MINUTES)
        for directory in JOB_ROOT.iterdir():
            if not directory.is_dir():
                continue
            with suppress(Exception):
                meta = read_meta(directory)
                created = datetime.fromisoformat(meta["created_at"])
                if created < cutoff:
                    remove_job(directory)
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(cleanup_expired_jobs())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title=APP_NAME, version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str | int]:
    return {"status": "ok", "ttl_minutes": JOB_TTL_MINUTES}


@app.post("/api/jobs")
async def create_job(
    files: list[UploadFile] = File(...),
    dedupe_key: str = Form("学号"),
    x_access_key: str | None = Header(default=None),
) -> dict:
    verify_access_key(x_access_key)
    if dedupe_key == "不去重":
        dedupe_key = ""

    job_id = uuid4().hex
    directory = job_dir(job_id)
    upload_dir = directory / "uploads"
    directory.mkdir(parents=True, exist_ok=False)
    download_token = secrets.token_urlsafe(32)

    metadata = {
        "job_id": job_id,
        "created_at": utc_now().isoformat(),
        "download_token": download_token,
        "status": "processing",
    }
    write_meta(directory, metadata)

    try:
        uploaded_paths = await save_uploads(files, upload_dir)
        result = await asyncio.to_thread(process_files, uploaded_paths, directory, dedupe_key)
        metadata.update(
            {
                "status": "ready",
                "output": result.output_path.name,
                "stats": result.stats,
            }
        )
        write_meta(directory, metadata)
        return {
            "job_id": job_id,
            "download_token": download_token,
            "expires_in_minutes": JOB_TTL_MINUTES,
            "stats": result.stats,
        }
    except HTTPException:
        remove_job(directory)
        raise
    except Exception as exc:
        remove_job(directory)
        raise HTTPException(status_code=422, detail=str(exc)[:500]) from exc


@app.get("/api/jobs/{job_id}/download")
def download_result(
    job_id: str,
    token: str,
    x_access_key: str | None = Header(default=None),
) -> FileResponse:
    verify_access_key(x_access_key)
    directory = job_dir(job_id)
    metadata = read_meta(directory)
    if not secrets.compare_digest(token, metadata.get("download_token", "")):
        raise HTTPException(status_code=403, detail="下载凭证无效")
    if metadata.get("status") != "ready":
        raise HTTPException(status_code=409, detail="汇总文件尚未生成")

    output = directory / metadata["output"]
    if not output.exists():
        raise HTTPException(status_code=404, detail="汇总文件不存在")

    metadata["transfer_started_at"] = utc_now().isoformat()
    write_meta(directory, metadata)
    return FileResponse(
        path=output,
        filename="总汇总表.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/jobs/{job_id}/confirm-download")
def confirm_download(
    job_id: str,
    token: str = Form(...),
    x_access_key: str | None = Header(default=None),
) -> dict[str, str]:
    verify_access_key(x_access_key)
    directory = job_dir(job_id)
    metadata = read_meta(directory)
    if not secrets.compare_digest(token, metadata.get("download_token", "")):
        raise HTTPException(status_code=403, detail="删除凭证无效")

    remove_job(directory)
    return {"status": "deleted", "message": "云端临时文件已删除"}


@app.delete("/api/jobs/{job_id}")
def cancel_job(
    job_id: str,
    token: str,
    x_access_key: str | None = Header(default=None),
) -> dict[str, str]:
    verify_access_key(x_access_key)
    directory = job_dir(job_id)
    metadata = read_meta(directory)
    if not secrets.compare_digest(token, metadata.get("download_token", "")):
        raise HTTPException(status_code=403, detail="删除凭证无效")
    remove_job(directory)
    return {"status": "deleted"}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
