import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');

test('分赛道后台生成器与前端模板语法有效', () => {
  execFileSync(process.execPath, ['--check', 'scripts/apply-track-admin-settings.mjs']);
  const frontend = read('templates/track-admin-settings-frontend.txt');
  assert.doesNotThrow(() => new Function(frontend));
});

test('用户列表按健康自律和四校区赛道独立筛选', () => {
  const generator = read('scripts/apply-track-admin-settings.mjs');
  assert.match(generator, /data-track-filter=\"health\"/);
  assert.match(generator, /data-track-filter=\"interaction\"/);
  assert.match(generator, /健康自律赛道/);
  assert.match(generator, /四校区赛道/);
  assert.match(generator, /track=\$\{adminDashboardState\.userTrack\}/);
  assert.match(generator, /completion\.tracks\?\.find/);
});

test('健康自律和四校区打卡设置分别保存且复用现有配置表', () => {
  const generator = read('scripts/apply-track-admin-settings.mjs');
  const frontend = read('templates/track-admin-settings-frontend.txt');
  assert.match(frontend, /data-checkin-track=\"health\"/);
  assert.match(frontend, /data-checkin-track=\"interaction\"/);
  assert.match(frontend, /早餐、午餐、晚餐时段/);
  assert.match(frontend, /队伍汇总照片数/);
  assert.match(generator, /putConfig\(env, 'healthCheckinSettings', settings\)/);
  assert.match(generator, /putConfig\(env, 'checkinSettings', settings\)/);
  assert.match(generator, /putConfig\(env, 'slots', slots\)/);
  assert.match(generator, /healthSettings\.personalImageLimit/);
  assert.doesNotMatch(generator, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
});

test('正式和隔离构建都会调用分赛道生成器', () => {
  const hook = read('scripts/apply-approved-plaza-prefetch.mjs');
  assert.match(hook, /await import\('\.\/apply-track-admin-settings\.mjs'\)/);
});
