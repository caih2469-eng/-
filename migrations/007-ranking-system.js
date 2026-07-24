const fs = require('fs');
const path = require('path');
const { migratePhase7 } = require('../lib/model');

const dataDir = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');
if (!fs.existsSync(dbFile)) process.exit(0);
const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
if (migratePhase7(data)) {
  const backup = `${dbFile}.backup-phase7-${Date.now()}`;
  fs.copyFileSync(dbFile, backup);
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`阶段 7 迁移完成，备份：${backup}`);
} else console.log('阶段 7 数据结构已是最新版本，无需迁移。');
