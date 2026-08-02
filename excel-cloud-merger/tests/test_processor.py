from pathlib import Path

import pandas as pd

from app.excel_processor import process_files


def test_merge_aliases_shifted_header_and_dedupe(tmp_path: Path) -> None:
    first = tmp_path / "一班.xlsx"
    second = tmp_path / "二班.xlsx"

    with pd.ExcelWriter(first, engine="openpyxl") as writer:
        pd.DataFrame([
            ["报名名单", "", ""],
            ["学生学号", "学生姓名", "所属专业"],
            ["001", "张三", "设计学"],
            ["002", "李四", "园林"],
        ]).to_excel(writer, index=False, header=False)

    pd.DataFrame([
        {"学号": "001", "姓名": "张三", "联系电话": "13800000000"},
        {"学号": "003", "姓名": "王五", "联系电话": "13900000000"},
    ]).to_excel(second, index=False)

    result = process_files([first, second], tmp_path / "job", dedupe_key="学号")
    assert result.output_path.exists()
    assert result.stats["original_rows"] == 4
    assert result.stats["result_rows"] == 3
    assert result.stats["duplicate_rows"] == 2

    merged = pd.read_excel(result.output_path, sheet_name="全部明细", dtype=object)
    assert set(merged["姓名"].astype(str)) == {"张三", "李四", "王五"}
    assert "来源文件" in merged.columns
