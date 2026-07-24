const fs = require('fs');
const path = require('path');
const { migratePhase11 } = require('../lib/model');

const dataDir = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');
if (!fs.existsSync(dbFile)) process.exit(0);
const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
if (migratePhase11(data)) {
  const backup = `${dbFile}.backup-phase11-${Date.now()}`;
  fs.copyFileSync(dbFile, backup);
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`个人打卡与队长权限迁移完成，备份：${backup}`);
} else console.log('个人打卡与队长权限数据结构已是最新版本。');
