import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('deploy/plaza-service.workflow.yml', 'utf8');
const testConfig = JSON.parse(fs.readFileSync('cloudflare/plaza-service/wrangler.test.jsonc', 'utf8'));
const productionConfig = JSON.parse(fs.readFileSync('cloudflare/plaza-service/wrangler.production.jsonc', 'utf8'));

test('广场服务工作流先验证再部署且仅授予只读仓库权限', () => {
  assert.match(workflow, /^name: Plaza service validation and deployment/m);
  assert.match(workflow, /^permissions:\s*\n  contents: read$/m);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /^  validate:/m);
  assert.match(workflow, /^  deploy-test:/m);
  assert.match(workflow, /^  deploy-production:/m);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /node --test test\/plaza-service-split\.test\.js/);
});

test('生产部署只允许main推送或main上的手动生产执行', () => {
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.environment == 'production'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /environment: cloudflare-production/);
});

test('工作流使用现有Cloudflare密钥并部署到正确配置', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /workingDirectory: cloudflare\/plaza-service/);
  assert.match(workflow, /deploy --config wrangler\.test\.jsonc/);
  assert.match(workflow, /deploy --config wrangler\.production\.jsonc/);
  assert.equal(testConfig.name, 'jinshan20-plaza-test');
  assert.equal(productionConfig.name, 'jinshan20-plaza');
  assert.equal(testConfig.workers_dev, false);
  assert.equal(productionConfig.workers_dev, false);
});

test('启用前模板与正式工作流路径分离', () => {
  assert.equal(fs.existsSync('.github/workflows/plaza-service.yml'), false);
  assert.match(workflow, /'\.github\/workflows\/plaza-service\.yml'/);
});
