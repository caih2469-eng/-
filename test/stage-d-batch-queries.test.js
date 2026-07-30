const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const user = {
  id: 'student-1',
  studentId: '246731001',
  name: '批量查询测试',
  role: 'student',
  campus: '南平',
  trackId: 'interaction',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z'
};

const createState = (taskCount) => {
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `task-${index + 1}`,
    name: `任务${index + 1}`,
    description: '',
    trackId: 'interaction',
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2035-01-01T00:00:00.000Z',
    allowLate: 0,
    imageLimit: 3,
    copyRequirement: '',
    submissionType: 'team',
    status: 'published',
    scheduleJson: null
  }));
  const materialTasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `material-${index + 1}`,
    title: `材料${index + 1}`,
    description: '',
    deadline: '2035-01-01T00:00:00.000Z',
    allowedTypesJson: '[".webp"]',
    fileLimit: 3,
    requireSummary: 0,
    ownerType: 'team',
    status: 'published'
  }));
  return { tasks, materialTasks, selectCount: 0, sql: [] };
};

class Statement {
  constructor(state, sql) {
    this.state = state;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
    if (/^SELECT /i.test(this.sql)) {
      state.selectCount += 1;
      state.sql.push(this.sql);
    }
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (/FROM makeup_permissions/i.test(this.sql)) return null;
    if (/FROM teams t JOIN team_members/i.test(this.sql)) {
      return {
        id: 'team-1',
        name: '第一队',
        inviteCode: 'TEAM0001',
        memberLimit: 4,
        captainId: user.id,
        createdAt: '2026-07-01T00:00:00.000Z'
      };
    }
    return null;
  }

  async all() {
    if (/FROM app_config/i.test(this.sql)) {
      return {
        results: [
          { key: 'activityEnabled', valueJson: 'true' },
          { key: 'trackEnabled', valueJson: '{"interaction":true,"health":true}' }
        ]
      };
    }
    if (/FROM tasks WHERE status='published'/i.test(this.sql)) {
      return { results: this.state.tasks.map((task) => ({ ...task })) };
    }
    if (/FROM team_members tm JOIN users/i.test(this.sql)) {
      return {
        results: Array.from({ length: 4 }, (_, index) => ({
          id: `student-${index + 1}`,
          studentId: `24673100${index + 1}`,
          name: `成员${index + 1}`,
          campus: '南平',
          trackId: 'interaction',
          status: 'active',
          createdAt: '2026-07-01T00:00:00.000Z'
        }))
      };
    }
    if (/FROM task_submissions/i.test(this.sql)) {
      return {
        results: this.state.tasks.map((task, index) => ({
          id: `submission-${index + 1}`,
          taskId: task.id,
          ownerType: 'team',
          ownerId: 'team-1',
          copy: '',
          plazaCopy: '',
          mealType: '',
          isPublic: 0,
          status: 'submitted',
          version: 1,
          occurrenceDate: '',
          submittedAt: '2026-07-30T00:00:00.000Z',
          reviewNote: ''
        }))
      };
    }
    if (/FROM task_submission_images/i.test(this.sql)) {
      return {
        results: this.state.tasks.map((_, index) => ({
          id: `image-${index + 1}`,
          submissionId: `submission-${index + 1}`,
          objectKey: `private/image-${index + 1}.webp`,
          contentType: 'image/webp',
          bytes: 40000,
          sortOrder: 0,
          mediaId: null,
          thumbMediaId: null
        }))
      };
    }
    if (/FROM member_checkins/i.test(this.sql)) {
      return {
        results: this.state.tasks.flatMap((task) => Array.from(
          { length: 4 },
          (_, index) => ({
            id: `checkin-${task.id}-${index + 1}`,
            taskId: task.id,
            occurrenceDate: '',
            userId: `student-${index + 1}`
          })
        ))
      };
    }
    if (/FROM material_tasks/i.test(this.sql)) {
      return { results: this.state.materialTasks.map((task) => ({ ...task })) };
    }
    if (/FROM material_submissions/i.test(this.sql)) {
      return {
        results: this.state.materialTasks.map((task, index) => ({
          id: `material-submission-${index + 1}`,
          taskId: task.id,
          ownerType: 'team',
          ownerId: 'team-1',
          summary: '',
          status: 'submitted',
          version: 1,
          submittedAt: '2026-07-30T00:00:00.000Z',
          reviewNote: '',
          updatedAt: '2026-07-30T00:00:00.000Z'
        }))
      };
    }
    if (/FROM material_files/i.test(this.sql)) {
      return {
        results: this.state.materialTasks.map((_, index) => ({
          id: `material-file-${index + 1}`,
          submissionId: `material-submission-${index + 1}`,
          originalName: `材料${index + 1}.webp`,
          contentType: 'image/webp',
          bytes: 40000
        }))
      };
    }
    return { results: [] };
  }

  async run() {
    return { success: true, meta: { changes: 0 } };
  }
}

const createEnv = (state) => ({
  ENVIRONMENT: 'test',
  DB: {
    prepare(sql) {
      return new Statement(state, sql);
    }
  }
});

test('阶段D：1个和20个活动任务的D1查询数量保持近似固定', async () => {
  const { buildStudentTasks } = await import('../cloudflare/services/student-dashboard.js');
  const one = createState(1);
  const oneResult = await buildStudentTasks(createEnv(one), user, { date: '2026-07-30' });
  assert.equal(oneResult.tasks.length, 1);
  assert.equal(oneResult.tasks[0].teamProgress.completed, 4);
  assert.ok(one.selectCount <= 8, `1个任务执行了${one.selectCount}次SELECT`);

  const twenty = createState(20);
  const twentyResult = await buildStudentTasks(createEnv(twenty), user, { date: '2026-07-30' });
  assert.equal(twentyResult.tasks.length, 20);
  assert.equal(twentyResult.tasks[19].submission.images.length, 1);
  assert.ok(twenty.selectCount <= 10, `20个任务执行了${twenty.selectCount}次SELECT`);
  assert.ok(
    twenty.selectCount - one.selectCount <= 2,
    `查询数随任务增长：1个=${one.selectCount}，20个=${twenty.selectCount}`
  );
});

test('阶段D：1个和20个材料任务不再逐任务查询提交与文件', async () => {
  const { buildStudentMaterialTasks } = await import('../cloudflare/services/student-dashboard.js');
  const one = createState(1);
  const oneResult = await buildStudentMaterialTasks(createEnv(one), user);
  assert.equal(oneResult.length, 1);
  assert.equal(oneResult[0].submission.files.length, 1);
  assert.ok(one.selectCount <= 4, `1个材料任务执行了${one.selectCount}次SELECT`);

  const twenty = createState(20);
  const twentyResult = await buildStudentMaterialTasks(createEnv(twenty), user);
  assert.equal(twentyResult.length, 20);
  assert.equal(twentyResult[19].submission.files.length, 1);
  assert.ok(twenty.selectCount <= 4, `20个材料任务执行了${twenty.selectCount}次SELECT`);
  assert.equal(twenty.selectCount, one.selectCount);
});

test('阶段D：历史记录代码使用批量IN查询且不逐条调用图片查询', () => {
  const source = fs.readFileSync('cloudflare/routes/student.js', 'utf8');
  const submissionHistory = source.slice(
    source.indexOf("if (route === '/api/submissions/history'"),
    source.indexOf("if (route === '/api/checkins/history'")
  );
  assert.match(submissionHistory, /submissionImagesForIds/);
  assert.doesNotMatch(submissionHistory, /for\s*\([^)]*of results\)\s*[^{}]*await\s+submissionImages/);

  const checkinHistory = source.slice(
    source.indexOf("if (route === '/api/checkins/history'"),
    source.indexOf('const memberMatch = route.match')
  );
  assert.match(checkinHistory, /f\.checkin_id IN \(\$\{recordPlaceholders\}\)/);
  assert.match(checkinHistory, /mapWithConcurrency\(fileRows,\s*6/);
  assert.doesNotMatch(checkinHistory, /WHERE f\.checkin_id=\?1/);
});
