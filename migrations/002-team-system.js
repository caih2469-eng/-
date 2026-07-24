const fs = require('fs');
const path = require('path');
const { migratePhase2 } = require('../lib/model');

const dataDir = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');

if (!fs.existsSync(dbFile)) {
  console.log('数据库尚未创建；首次启动服务时会使用新结构初始化。');
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const changed = migratePhase2(data);
if (changed) {
  const backup = `${dbFile}.backup-phase2-${Date.now()}`;
  fs.copyFileSync(dbFile, backup);
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`阶段 2 迁移完成，备份：${backup}`);
} else {
  console.log('阶段 2 数据结构已是最新版本，无需迁移。');
}
