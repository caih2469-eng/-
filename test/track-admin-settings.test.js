import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');

test('分赛道后台生成器与前端模板语法有效', () => {
  execFileSync(process.execPath, ['--check', 'scripts/apply-track-admin-settings.mjs']);
  execFileSync(process.execPath, ['--check', 'scripts/apply-track-admin-settings-compat.mjs']);
  execFileSync(process.execPath, ['--check', 'scripts/apply-health-client-checkin.mjs']);
  const frontend = read('templates/track-admin-settings-frontend.txt');
  const healthHome = read('templates/health-client-checkin-home.txt');
  assert.doesNotThrow(() => new Function(frontend));
  assert.doesNotThrow(() => new Function(healthHome));
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

test('健康自律客户端直接显示餐次打卡且沿用后台配置', () => {
  const generator = read('scripts/apply-health-client-checkin.mjs');
  const homeTemplate = read('templates/health-client-checkin-home.txt');
  const compat = read('scripts/apply-track-admin-settings-compat.mjs');
  assert.match(compat, /apply-health-client-checkin\.mjs/);
  assert.match(generator, /public\/app\.js/);
  assert.match(generator, /health-client-checkin-home\.txt/);
  assert.match(generator, /HEALTH_CLIENT_CHECKIN_V1/);
  assert.match(homeTemplate, /data-health-client-slot/);
  assert.match(homeTemplate, /\/api\/checkins\?date=/);
  assert.match(homeTemplate, /api\('\/api\/checkins'/);
  assert.match(homeTemplate, /settings\.personalImageLimit/);
  assert.match(homeTemplate, /settings\.activeStartDate/);
  assert.match(homeTemplate, /settings\.weekdays/);
  assert.match(homeTemplate, /开始打卡/);
  assert.match(homeTemplate, /更新打卡/);
  assert.match(homeTemplate, /MutationObserver/);
  assert.match(homeTemplate, /健康自律赛道当前未开放/);
  assert.match(homeTemplate, /今天不开放健康自律赛道打卡/);
  assert.doesNotMatch(generator + homeTemplate, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
});

test('正式和隔离构建都会调用兼容包装后的分赛道生成器', () => {
  const hook = read('scripts/apply-approved-plaza-prefetch.mjs');
  const compat = read('scripts/apply-track-admin-settings-compat.mjs');
  assert.match(hook, /apply-track-admin-settings-compat\.mjs/);
  assert.match(compat, /apply-track-admin-settings\.mjs/);
  assert.match(compat, /apply-health-client-checkin\.mjs/);
});
