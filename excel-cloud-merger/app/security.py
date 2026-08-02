from __future__ import annotations

import re
import shutil
import stat
import zipfile
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from .config import (
    ALLOWED_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    MAX_ZIP_ENTRIES,
    MAX_ZIP_UNCOMPRESSED_BYTES,
)

_SAFE_NAME_RE = re.compile(r"[^\w\-.\u4e00-\u9fff]+", re.UNICODE)


def safe_filename(name: str) -> str:
    base = Path(name or "unnamed").name
    cleaned = _SAFE_NAME_RE.sub("_", base).strip("._")
    return cleaned[:120] or "unnamed"


async def save_uploads(files: list[UploadFile], upload_dir: Path) -> list[Path]:
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    total = 0

    for item in files:
        original = safe_filename(item.filename or "unnamed")
        ext = Path(original).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的文件类型：{original}",
            )

        target = upload_dir / f"{uuid4().hex[:10]}_{original}"
        with target.open("wb") as handle:
            while True:
                chunk = await item.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"上传总大小不能超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB",
                    )
                handle.write(chunk)
        await item.close()
        saved.append(target)

    if not saved:
        raise HTTPException(status_code=400, detail="至少上传一个文件")
    return saved


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_ISLNK(mode)


def extract_zip_safely(zip_path: Path, destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []

    try:
        archive = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise ValueError(f"ZIP 文件损坏：{zip_path.name}") from exc

    with archive:
        entries = [info for info in archive.infolist() if not info.is_dir()]
        if len(entries) > MAX_ZIP_ENTRIES:
            raise ValueError(f"ZIP 内文件数量超过 {MAX_ZIP_ENTRIES} 个")

        total_uncompressed = sum(info.file_size for info in entries)
        if total_uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES:
            limit_mb = MAX_ZIP_UNCOMPRESSED_BYTES // 1024 // 1024
            raise ValueError(f"ZIP 解压后总大小超过 {limit_mb} MB")

        for info in entries:
            if _is_symlink(info):
                raise ValueError("ZIP 中包含不允许的符号链接")

            member = Path(info.filename.replace("\\", "/"))
            if member.is_absolute() or ".." in member.parts:
                raise ValueError("ZIP 中包含不安全路径")

            ext = member.suffix.lower()
            if ext not in {".xlsx", ".xls", ".csv"}:
                continue

            target = destination / f"{uuid4().hex[:10]}_{safe_filename(member.name)}"
            with archive.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            extracted.append(target)

    return extracted
