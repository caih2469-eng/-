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

test('健康自律客户端仅由健康学生按需加载且沿用后台配置', () => {
  execFileSync(process.execPath, ['scripts/apply-health-client-checkin.mjs'], { stdio: 'pipe' });
  const generator = read('scripts/apply-health-client-checkin.mjs');
  const app = read('public/app.js');
  const module = read('public/health-checkin.js');
  const homeTemplate = read('templates/health-client-checkin-home.txt');
  const compat = read('scripts/apply-track-admin-settings-compat.mjs');
  assert.match(compat, /apply-health-client-checkin\.mjs/);
  assert.match(generator, /public\/app\.js/);
  assert.match(generator, /public\/health-checkin\.js/);
  assert.match(generator, /health-client-checkin-home\.txt/);
  assert.match(app, /LAZY_HEALTH_CLIENT_MODULE_V1/);
  assert.match(app, /user\?\.role !== 'student' \|\| user\.trackId !== 'health'/);
  assert.match(app, /if \(user\?\.role === 'student' && user\.trackId === 'health'\)/);
  assert.match(app, /new URL\('\/health-checkin\.js', location\.origin\)/);
  assert.match(app, /moduleUrl\.searchParams\.set\('v', version\)/);
  assert.doesNotMatch(app, /const healthClientVersion = 'health-client-checkin-v1'/);
  assert.match(module, /HEALTH_CLIENT_CHECKIN_MODULE_V1/);
  assert.match(module, /data-health-client-slot/);
  assert.match(module, /\/api\/checkins\?date=/);
  assert.match(module, /api\('\/api\/checkins'/);
  assert.match(module, /settings\.personalImageLimit/);
  assert.match(module, /settings\.activeStartDate/);
  assert.match(module, /settings\.weekdays/);
  assert.match(module, /开始打卡/);
  assert.match(module, /更新打卡/);
  assert.match(module, /MutationObserver/);
  assert.match(module, /健康自律赛道当前未开放/);
  assert.match(module, /今天不开放健康自律赛道打卡/);
  assert.equal(module.slice(module.indexOf('(() => {')).trim(), `${homeTemplate.trim()}\n`);
  assert.doesNotMatch(generator + module, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
});

test('健康打卡模块生成器可重复执行且第二次不重复加载器', () => {
  execFileSync(process.execPath, ['scripts/apply-health-client-checkin.mjs'], { stdio: 'pipe' });
  const firstApp = read('public/app.js');
  const firstModule = read('public/health-checkin.js');
  execFileSync(process.execPath, ['scripts/apply-health-client-checkin.mjs'], { stdio: 'pipe' });
  assert.equal(read('public/app.js'), firstApp);
  assert.equal(read('public/health-checkin.js'), firstModule);
  assert.equal((firstApp.match(/LAZY_HEALTH_CLIENT_MODULE_V1/g) || []).length, 1);
});

test('正式和隔离构建都会调用兼容包装后的分赛道生成器', () => {
  const hook = read('scripts/apply-approved-plaza-prefetch.mjs');
  const compat = read('scripts/apply-track-admin-settings-compat.mjs');
  assert.match(hook, /apply-track-admin-settings-compat\.mjs/);
  assert.match(compat, /apply-track-admin-settings\.mjs/);
  assert.match(compat, /apply-health-client-checkin\.mjs/);
});