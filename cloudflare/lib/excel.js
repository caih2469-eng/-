import ExcelJS from 'exceljs';

const cellText = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text);
    if ('result' in value) return String(value.result ?? '');
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
  }
  return String(value);
};

export const readWorkbookRows = async (dataUrl, aliases, required = []) => {
  const match = String(dataUrl || '').match(/^data:.*?;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Object.assign(new Error('请选择有效的 Excel 文件'), { status: 400 });
  const bytes = Uint8Array.from(atob(match[1].replace(/\s/g, '')), (char) => char.charCodeAt(0));
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw Object.assign(new Error('Excel 文件不能超过 10MB'), { status: 413 });
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw Object.assign(new Error('Excel 中没有可导入的数据'), { status: 400 });
  const headers = {};
  sheet.getRow(1).eachCell((cell, column) => {
    const value = cellText(cell.value).trim().toLowerCase();
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(value)) headers[field] = column;
    }
  });
  const missing = required.filter((field) => !headers[field]);
  if (missing.length) {
    throw Object.assign(new Error('Excel 缺少必要列，请检查第一行中文表头是否完整'), { status: 400 });
  }
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = {};
    for (const [field, column] of Object.entries(headers)) {
      row[field] = cellText(sheet.getRow(rowNumber).getCell(column).value).trim();
    }
    if (Object.values(row).some(Boolean)) rows.push({ rowNumber, ...row });
  }
  return rows;
};

export const excelResponse = async (filename, columns, rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据');
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 18,
    style: { numFmt: column.text ? '@' : 'General' }
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const added = sheet.addRow(row);
    columns.forEach((column, index) => {
      if (column.text) {
        added.getCell(index + 1).value = String(row[column.key] ?? '');
        added.getCell(index + 1).numFmt = '@';
      }
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
};
