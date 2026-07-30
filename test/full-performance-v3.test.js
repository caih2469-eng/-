const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const checkScript = (file) => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};

test('performance v3 browser scripts pass syntax checks', () => {
  checkScript('public/bootstrap.js');
  checkScript('public/performance-v3.js');
});

test('startup preloads app resources and propagates D1 bookmarks', () => {
  const bootstrap = source('public/bootstrap.js');
  const runtime = source('public/performance-v3.js');
  assert.match(bootstrap, /rel = 'preload'/);
  assert.match(bootstrap, /performance-v3\.js/);
  assert.match(bootstrap, /x-d1-bookmark/);
  assert.match(runtime, /sessionStorage\.getItem\(BOOKMARK_KEY\)/);
  assert.match(runtime, /response\.headers\.get\('x-d1-bookmark'\)/);
});

test('non-plaza thumbnail compression and upload are completed locally', () => {
  const runtime = source('public/performance-v3.js');
  assert.match(runtime, /body\?\.variant === 'thumb'/);
  assert.match(runtime, /SKIP_THUMB_BUSINESS_TYPES/);
  assert.match(runtime, /'meal-checkin'/);
  assert.match(runtime, /'material-image'/);
  assert.match(runtime, /'member-checkin'/);
  assert.match(runtime, /pendingSkippedThumbCompression/);
  assert.match(runtime, /maxEdge <= 360/);
  assert.match(runtime, /skippedThumb: true/);
  assert.doesNotMatch(runtime, /SKIP_THUMB_BUSINESS_TYPES[\s\S]*?'task'/);
});

test('Pages functions use request-scoped D1 sessions and safe fast upload override', () => {
  const wrapper = source('cloudflare/lib/d1-session-wrapper.js');
  assert.match(wrapper, /withSession/);
  assert.match(wrapper, /first-unconstrained/);
  assert.match(wrapper, /first-primary/);
  assert.match(wrapper, /getBookmark/);
  assert.match(source('cloudflare/routes/member-fast-v3-safe.js'), /errorResponse/);
  for (const environment of ['test', 'staging', 'production']) {
    const entry = source(`cloudflare/pages-${environment}/functions/[[path]].js`);
    assert.match(entry, /withD1Session/);
    assert.match(entry, /handleMemberFastV3Safe/);
  }
});

test('optimized member upload removes redundant R2 HEAD calls', () => {
  const route = source('cloudflare/routes/member-fast-v3.js');
  assert.match(route, /env\.DB\.batch/);
  assert.match(route, /env\.UPLOADS\.put\(objectKey, buffer/);
  assert.doesNotMatch(route, /env\.UPLOADS\.head/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /signatureMatches/);
  assert.match(route, /MAX_BYTES = 307_200/);
});
