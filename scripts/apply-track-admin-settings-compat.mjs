import fs from 'node:fs';
import path from 'node:path';

const runtimePath = path.resolve('cloudflare/lib/runtime.js');
const configuredLine = '      configured: Boolean(values.checkinSettings),\n';
let runtime = fs.readFileSync(runtimePath, 'utf8');
const restoreConfigured = runtime.includes(configuredLine);

if (restoreConfigured) {
  runtime = runtime.replace(configuredLine, '');
  fs.writeFileSync(runtimePath, runtime, 'utf8');
}

try {
  await import('./apply-track-admin-settings.mjs');
  await import('./apply-health-client-checkin.mjs');
} finally {
  if (restoreConfigured) {
    runtime = fs.readFileSync(runtimePath, 'utf8');
    if (!runtime.includes(configuredLine)) {
      const anchor = '    checkinSettings: {\n      enabled:';
      if (!runtime.includes(anchor)) {
        throw new Error('分赛道设置生成后无法恢复四校区配置兼容标记');
      }
      runtime = runtime.replace(
        anchor,
        `    checkinSettings: {\n${configuredLine}      enabled:`
      );
      fs.writeFileSync(runtimePath, runtime, 'utf8');
    }
  }
}

console.log('Applied track-aware settings and health client check-in with generated-runtime compatibility.');
