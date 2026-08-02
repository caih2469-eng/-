from pathlib import Path
import zipfile

import pytest

from app.security import extract_zip_safely


def test_zip_path_traversal_is_rejected(tmp_path: Path) -> None:
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("../escape.xlsx", b"not excel")
    with pytest.raises(ValueError):
        extract_zip_safely(archive, tmp_path / "out")
