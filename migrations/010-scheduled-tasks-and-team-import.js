const fs = require('fs');
const path = require('path');
const { migratePhase10 } = require('../lib/model');

const dataDir = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');
if (!fs.existsSync(dbFile)) process.exit(0);
const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
if (migratePhase10(data)) {
  const backup = `${dbFile}.backup-phase10-${Date.now()}`;
  fs.copyFileSync(dbFile, backup);
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`任务日程与统一编队迁移完成，备份：${backup}`);
} else console.log('任务日程与统一编队数据结构已是最新版本。');
