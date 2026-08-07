import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'cloudflare/services/student-dashboard.js');
const marker = '/* STRICT_P95_DASHBOARD_BATCH_V4 */';
const read = () => fs.readFileSync(file, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

let source = read();
if (!source.includes(marker)) {
  const taskAnchor = 'export const buildStudentTasks = async (env, user, options = {}) => {';
  const teamContext = `${marker}\nexport const buildStudentTeamContext = async (env, user) => {\n  if (user.role !== 'student' || user.trackId !== 'interaction') {\n    return { team: null, members: [], teamCount: null };\n  }\n  const [countRow, memberPage] = await Promise.all([\n    env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first(),\n    env.DB.prepare(\n      \`SELECT t.id AS teamId,t.name AS teamName,t.invite_code AS inviteCode,\n              t.member_limit AS memberLimit,t.captain_user_id AS captainId,t.created_at AS teamCreatedAt,\n              u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,\n              u.track_id AS memberTrackId,u.status AS memberStatus,u.created_at AS memberCreatedAt\n         FROM team_members mine\n         JOIN teams t ON t.id=mine.team_id\n         LEFT JOIN team_members tm ON tm.team_id=t.id\n         LEFT JOIN users u ON u.id=tm.user_id\n        WHERE mine.user_id=?1\n        ORDER BY tm.joined_at,u.student_id\`\n    ).bind(user.id).all()\n  ]);\n  const rows = memberPage.results || [];\n  if (!rows.length || !rows[0].teamId) {\n    return { team: null, members: [], teamCount: Number(countRow?.total || 0) };\n  }\n  const first = rows[0];\n  const team = {\n    id: first.teamId,\n    name: first.teamName,\n    inviteCode: first.inviteCode,\n    memberLimit: first.memberLimit,\n    captainId: first.captainId,\n    createdAt: first.teamCreatedAt\n  };\n  const members = rows.filter((row) => row.memberId).map((row) => ({\n    id: row.memberId,\n    studentId: row.memberStudentId,\n    name: row.memberName,\n    campus: row.memberCampus,\n    trackId: row.memberTrackId,\n    status: row.memberStatus,\n    createdAt: row.memberCreatedAt\n  }));\n  return { team, members, teamCount: Number(countRow?.total || 0) };\n};\n\n${taskAnchor}`;
  source = replaceOnce(source, taskAnchor, teamContext, '学生Dashboard共享队伍上下文位置');

  const taskQueryOld = `  const { results } = await env.DB.prepare(\n    \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n            allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n            submission_type AS submissionType,status,schedule_json AS scheduleJson\n       FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n      ORDER BY starts_at DESC LIMIT 100\`\n  ).bind(user.role, user.trackId || '').all();\n  const today = options.date || shanghaiDate();\n  const makeupAllowed = user.role === 'student'\n    ? await hasMakeupPermission(env, user.id, today) : false;`;
  const taskQueryNew = `  const today = options.date || shanghaiDate();\n  const [taskPage, makeupAllowed] = await Promise.all([\n    env.DB.prepare(\n      \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n              submission_type AS submissionType,status,schedule_json AS scheduleJson\n         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n        ORDER BY starts_at DESC LIMIT 100\`\n    ).bind(user.role, user.trackId || '').all(),\n    user.role === 'student'\n      ? hasMakeupPermission(env, user.id, today)\n      : Promise.resolve(false)\n  ]);\n  const results = taskPage.results || [];`;
  source = replaceOnce(source, taskQueryOld, taskQueryNew, '活动任务与补签权限并行查询区块');

  const taskTeamOld = `  const team = needsTeam ? await teamForUser(env, user.id) : null;\n  const members = team ? await membersForTeam(env, team.id) : [];`;
  const taskTeamNew = `  const sharedTeamContext = options.teamContext || null;\n  const team = needsTeam\n    ? (sharedTeamContext ? sharedTeamContext.team : await teamForUser(env, user.id))\n    : null;\n  const members = team\n    ? (sharedTeamContext && sharedTeamContext.team?.id === team.id\n      ? sharedTeamContext.members\n      : await membersForTeam(env, team.id))\n    : [];`;
  source = replaceOnce(source, taskTeamOld, taskTeamNew, '活动任务共享队伍上下文区块');

  const submissionsAnchor = '  const submissions = [];';
  const concurrentCheckins = `  const checkinsPromise = (team && taskIds.length)\n    ? (async () => {\n      const rows = [];\n      for (const taskChunk of chunks(taskIds, 75)) {\n        const taskIn = placeholders(taskChunk.length, 2);\n        const occurrenceStart = taskChunk.length + 2;\n        const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);\n        const page = await env.DB.prepare(\n          \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate\n             FROM member_checkins\n            WHERE team_id=?1 AND task_id IN (\${taskIn})\n              AND occurrence_date IN (\${occurrenceIn})\`\n        ).bind(team.id, ...taskChunk, ...occurrenceDates).all();\n        rows.push(...page.results);\n      }\n      return rows;\n    })()\n    : Promise.resolve([]);\n\n${submissionsAnchor}`;
  source = replaceOnce(source, submissionsAnchor, concurrentCheckins, '成员打卡并发查询启动位置');

  const checkinsOld = `  const checkins = [];\n  if (team && taskIds.length) {\n    for (const taskChunk of chunks(taskIds, 75)) {\n      const taskIn = placeholders(taskChunk.length, 2);\n      const occurrenceStart = taskChunk.length + 2;\n      const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);\n      const page = await env.DB.prepare(\n        \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate\n           FROM member_checkins\n          WHERE team_id=?1 AND task_id IN (\${taskIn})\n            AND occurrence_date IN (\${occurrenceIn})\`\n      ).bind(team.id, ...taskChunk, ...occurrenceDates).all();\n      checkins.push(...page.results);\n    }\n  }`;
  source = replaceOnce(source, checkinsOld, '  const checkins = await checkinsPromise;', '成员打卡串行查询区块');

  source = replaceOnce(
    source,
    'export const buildStudentMaterialTasks = async (env, user) => {',
    'export const buildStudentMaterialTasks = async (env, user, options = {}) => {',
    '材料任务共享上下文函数签名'
  );
  source = replaceOnce(
    source,
    `  const team = needsTeam ? await teamForUser(env, user.id) : null;\n  const ownerPairs = [{ type: 'user', id: user.id }];`,
    `  const sharedTeamContext = options.teamContext || null;\n  const team = needsTeam\n    ? (sharedTeamContext ? sharedTeamContext.team : await teamForUser(env, user.id))\n    : null;\n  const ownerPairs = [{ type: 'user', id: user.id }];`,
    '材料任务共享队伍上下文区块'
  );

  source = replaceOnce(
    source,
    'export const buildTeamSummary = async (env, user, config) => {',
    'export const buildTeamSummary = async (env, user, config, options = {}) => {',
    '队伍摘要共享上下文函数签名'
  );
  const teamSummaryAnchor = `  if (user.trackId !== 'interaction') return null;\n  const [count, team] = await Promise.all([`;
  const teamSummaryShared = `  if (user.trackId !== 'interaction') return null;\n  const sharedTeamContext = options.teamContext || null;\n  if (sharedTeamContext) {\n    const team = sharedTeamContext.team;\n    return {\n      teamCount: Number(sharedTeamContext.teamCount || 0),\n      maxTeams: Number(config.maxTeams || 50),\n      team: team ? { ...team, members: sharedTeamContext.members, memberCount: sharedTeamContext.members.length } : null\n    };\n  }\n  const [count, team] = await Promise.all([`;
  source = replaceOnce(source, teamSummaryAnchor, teamSummaryShared, '队伍摘要共享上下文分支');

  const dashboardOld = `export const buildStudentDashboard = async (env, user, options = {}) => {\n  const date = options.date || shanghaiDate();\n  const config = options.config || await readConfig(env);\n  const [teamSummary, taskResult, materialTasks] = await Promise.all([\n    buildTeamSummary(env, user, config),\n    buildStudentTasks(env, user, { config, date }),\n    buildStudentMaterialTasks(env, user)\n  ]);`;
  const dashboardNew = `export const buildStudentDashboard = async (env, user, options = {}) => {\n  const date = options.date || shanghaiDate();\n  const [config, teamContext] = await Promise.all([\n    options.config ? Promise.resolve(options.config) : readConfig(env),\n    options.teamContext ? Promise.resolve(options.teamContext) : buildStudentTeamContext(env, user)\n  ]);\n  const [teamSummary, taskResult, materialTasks] = await Promise.all([\n    buildTeamSummary(env, user, config, { teamContext }),\n    buildStudentTasks(env, user, { config, date, teamContext }),\n    buildStudentMaterialTasks(env, user, { teamContext })\n  ]);`;
  source = replaceOnce(source, dashboardOld, dashboardNew, '学生Dashboard并行聚合区块');

  fs.writeFileSync(file, source, 'utf8');
}

const output = read();
if (!output.includes(marker)
    || !output.includes('buildStudentTeamContext')
    || !output.includes('const [taskPage, makeupAllowed] = await Promise.all([')
    || !output.includes('const checkinsPromise = (team && taskIds.length)')
    || !output.includes('const checkins = await checkinsPromise;')
    || !output.includes('buildStudentMaterialTasks(env, user, { teamContext })')
    || !output.includes('buildTeamSummary(env, user, config, { teamContext })')) {
  throw new Error('学生Dashboard严格p95聚合优化生成不完整');
}

console.log('Applied strict p95 Dashboard V4: shared team context and overlapped D1 reads.');
