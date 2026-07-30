import {
  hasMakeupPermission,
  parseJson,
  readConfig,
  shanghaiDate,
  shanghaiTime,
  TRACKS
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';

const QUERY_CHUNK_SIZE = 80;
const SIGN_CONCURRENCY = 6;

const unique = (values) => [...new Set(values.filter(Boolean))];
const chunks = (values, size = QUERY_CHUNK_SIZE) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};
const placeholders = (count, start = 1) => Array.from(
  { length: count },
  (_, index) => `?${start + index}`
).join(',');

export const mapWithConcurrency = async (items, concurrency, mapper) => {
  if (!items.length) return [];
  const output = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker()
  ));
  return output;
};

export const teamForUser = (env, userId) => env.DB.prepare(
  `SELECT t.id, t.name, t.invite_code AS inviteCode, t.member_limit AS memberLimit,
          t.captain_user_id AS captainId, t.created_at AS createdAt
     FROM teams t JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?1 LIMIT 1`
).bind(userId).first();

export const membersForTeam = async (env, teamId) => {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.student_id AS studentId, u.name, u.campus, u.track_id AS trackId,
            u.status, u.created_at AS createdAt
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?1 ORDER BY tm.joined_at, u.student_id`
  ).bind(teamId).all();
  return results;
};

export const isTaskOccurrence = (task, occurrenceDate = '') => {
  const schedule = task.scheduleJson ? parseJson(task.scheduleJson, null) : null;
  if (!schedule) return Date.now() >= Date.parse(task.startsAt) && Date.now() <= Date.parse(task.endsAt);
  const today = shanghaiDate();
  if (occurrenceDate && occurrenceDate !== today) return false;
  if (today < schedule.activeStartDate || today > schedule.activeEndDate) return false;
  if (schedule.scheduleType === 'activityDays') {
    const [startYear, startMonth, startDay] = schedule.activeStartDate.split('-').map(Number);
    const [year, month, day] = today.split('-').map(Number);
    const activityDay = Math.floor((Date.UTC(year, month - 1, day)
      - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000) + 1;
    if (!schedule.refreshDays.includes(activityDay)) return false;
  }
  if (schedule.scheduleType === 'weekly') {
    const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay() || 7;
    if (!schedule.weekdays.includes(weekday)) return false;
  }
  return true;
};

export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {
  if (!isTaskOccurrence(task, occurrenceDate)) return false;
  if (makeupAllowed) return true;
  const schedule = task.scheduleJson ? parseJson(task.scheduleJson, null) : null;
  if (!schedule) return true;
  if (schedule.dailyStart && shanghaiTime() < schedule.dailyStart) return false;
  if (schedule.dailyEnd && shanghaiTime() > schedule.dailyEnd) return false;
  return true;
};

export const submissionOwner = async (env, user, task) => {
  if (task.submissionType === 'team' || task.trackId === 'interaction') {
    const team = await teamForUser(env, user.id);
    if (!team) throw Object.assign(new Error('尚未分配队伍'), { status: 403 });
    return { type: 'team', id: team.id, team };
  }
  return { type: 'user', id: user.id, team: null };
};

export const submissionImages = async (env, submissionId, viewer) => {
  const grouped = await submissionImagesForIds(env, [submissionId], viewer);
  return grouped.get(submissionId) || [];
};

const signSubmissionImageRows = async (env, rows, viewer) => mapWithConcurrency(
  rows,
  SIGN_CONCURRENCY,
  async (item) => {
    const audience = viewer.role === 'admin' ? 'admin' : 'owner';
    const displayUrl = item.mediaId
      ? await createPrivateMediaUrl(env, item, audience, viewer.id)
      : `/api/files/${item.id}`;
    const thumbUrl = item.thumbMediaId
      ? await createPrivateMediaUrl(env, {
        id: item.thumbMediaId,
        objectKey: item.thumbObjectKey
      }, audience, viewer.id)
      : displayUrl;
    return { ...item, thumbUrl, displayUrl, imageUrl: thumbUrl, url: thumbUrl };
  }
);

export const submissionImagesForIds = async (env, submissionIds, viewer) => {
  const ids = unique(submissionIds);
  const grouped = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return grouped;
  const imageRows = [];
  for (const idChunk of chunks(ids)) {
    const { results } = await env.DB.prepare(
      `SELECT i.id,i.submission_id AS submissionId,
              COALESCE(m.object_key,i.object_key) AS objectKey,
              i.content_type AS contentType,i.bytes,
              i.sort_order AS sortOrder,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey,
              tm.mime_type AS thumbContentType,tm.file_size AS thumbBytes
         FROM task_submission_images i
         LEFT JOIN media_objects m ON m.id=i.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
        WHERE i.submission_id IN (${placeholders(idChunk.length)})
        ORDER BY i.submission_id,i.sort_order`
    ).bind(...idChunk).all();
    imageRows.push(...results);
  }
  const signed = await signSubmissionImageRows(env, imageRows, viewer);
  for (const image of signed) {
    if (!grouped.has(image.submissionId)) grouped.set(image.submissionId, []);
    grouped.get(image.submissionId).push(image);
  }
  return grouped;
};

export const buildStudentTasks = async (env, user, options = {}) => {
  const config = options.config || await readConfig(env);
  if (user.role === 'student' && (!config.activityEnabled || !config.trackEnabled[user.trackId])) {
    return {
      tasks: [],
      switches: {
        activityEnabled: config.activityEnabled,
        trackEnabled: config.trackEnabled
      }
    };
  }
  const { results } = await env.DB.prepare(
    `SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
            allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
            submission_type AS submissionType,status,schedule_json AS scheduleJson
       FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)
      ORDER BY starts_at DESC LIMIT 100`
  ).bind(user.role, user.trackId || '').all();
  const today = options.date || shanghaiDate();
  const makeupAllowed = user.role === 'student'
    ? await hasMakeupPermission(env, user.id, today) : false;
  const visibleTasks = results.filter(
    (task) => !task.scheduleJson || isTaskOccurrence(task, today)
  );
  const needsTeam = user.role === 'student' && visibleTasks.some(
    (task) => task.submissionType === 'team' || task.trackId === 'interaction'
  );
  const team = needsTeam ? await teamForUser(env, user.id) : null;
  const members = team ? await membersForTeam(env, team.id) : [];
  const taskIds = unique(visibleTasks.map((task) => task.id));
  const occurrenceDates = unique(visibleTasks.map(
    (task) => (task.scheduleJson ? today : '')
  ));
  if (!occurrenceDates.includes('')) occurrenceDates.push('');

  const ownerPairs = [];
  if (user.role === 'student') {
    if (visibleTasks.some((task) => task.submissionType !== 'team' && task.trackId !== 'interaction')) {
      ownerPairs.push({ type: 'user', id: user.id });
    }
    if (team) ownerPairs.push({ type: 'team', id: team.id });
  }

  const submissions = [];
  if (taskIds.length && ownerPairs.length) {
    for (const taskChunk of chunks(taskIds, 70)) {
      const values = [...taskChunk, ...occurrenceDates];
      const taskIn = placeholders(taskChunk.length);
      const occurrenceIn = placeholders(occurrenceDates.length, taskChunk.length + 1);
      const ownerStart = taskChunk.length + occurrenceDates.length + 1;
      const ownerSql = ownerPairs.map((owner, index) => {
        const parameter = ownerStart + (index * 2);
        values.push(owner.type, owner.id);
        return `(owner_type=?${parameter} AND owner_id=?${parameter + 1})`;
      }).join(' OR ');
      const page = await env.DB.prepare(
        `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
                copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
                submitted_at AS submittedAt,review_note AS reviewNote
           FROM task_submissions
          WHERE task_id IN (${taskIn})
            AND occurrence_date IN (${occurrenceIn})
            AND (${ownerSql})`
      ).bind(...values).all();
      submissions.push(...page.results);
    }
  }
  const imagesBySubmission = await submissionImagesForIds(
    env,
    submissions.map((submission) => submission.id),
    user
  );
  const submissionsByOwnerTask = new Map();
  for (const submission of submissions) {
    submission.images = imagesBySubmission.get(submission.id) || [];
    submissionsByOwnerTask.set(
      `${submission.taskId}|${submission.ownerType}|${submission.ownerId}|${submission.occurrenceDate}`,
      submission
    );
  }

  const checkins = [];
  if (team && taskIds.length) {
    for (const taskChunk of chunks(taskIds, 75)) {
      const taskIn = placeholders(taskChunk.length, 2);
      const occurrenceStart = taskChunk.length + 2;
      const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);
      const page = await env.DB.prepare(
        `SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate
           FROM member_checkins
          WHERE team_id=?1 AND task_id IN (${taskIn})
            AND occurrence_date IN (${occurrenceIn})`
      ).bind(team.id, ...taskChunk, ...occurrenceDates).all();
      checkins.push(...page.results);
    }
  }
  const checkinsByTask = new Map();
  for (const checkin of checkins) {
    const key = `${checkin.taskId}|${checkin.occurrenceDate}`;
    if (!checkinsByTask.has(key)) checkinsByTask.set(key, []);
    checkinsByTask.get(key).push(checkin);
  }

  const tasks = [];
  for (const task of visibleTasks) {
    const usesTeam = task.submissionType === 'team' || task.trackId === 'interaction';
    const owner = user.role === 'admin'
      ? null
      : (usesTeam
        ? (team ? { type: 'team', id: team.id, team } : null)
        : { type: 'user', id: user.id, team: null });
    const occurrenceDate = task.scheduleJson ? today : '';
    const submission = owner
      ? submissionsByOwnerTask.get(`${task.id}|${owner.type}|${owner.id}|${occurrenceDate}`) || null
      : null;
    const schedule = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};
    let teamProgress = null;
    let memberCheckin = null;
    let isCaptain = false;
    if (owner?.team) {
      const taskCheckins = checkinsByTask.get(`${task.id}|${occurrenceDate}`) || [];
      const completedUserIds = new Set(taskCheckins.map((item) => item.userId));
      teamProgress = {
        total: members.length,
        completed: taskCheckins.length,
        members: members.map((member) => ({
          ...member,
          checked: completedUserIds.has(member.id)
        }))
      };
      memberCheckin = taskCheckins.find((item) => item.userId === user.id) || null;
      isCaptain = owner.team.captainId === user.id;
    }
    const canSubmit = user.role === 'student' && taskWindowOpen(task, occurrenceDate, makeupAllowed);
    tasks.push({
      ...task,
      startAt: task.startsAt,
      endAt: task.endsAt,
      allowLate: Boolean(task.allowLate),
      schedule,
      scheduleType: schedule.scheduleType || 'single',
      refreshDays: schedule.refreshDays || [],
      weekdays: schedule.weekdays || [],
      dailyStart: schedule.dailyStart || '',
      dailyEnd: schedule.dailyEnd || '',
      occurrenceDate,
      canSubmit,
      availabilityError: user.role === 'student' && !canSubmit ? '当前不在任务提交时间范围内' : '',
      makeupAllowed,
      submission,
      teamProgress,
      memberCheckin,
      isCaptain
    });
  }
  return {
    tasks,
    switches: {
      activityEnabled: config.activityEnabled,
      trackEnabled: config.trackEnabled
    }
  };
};

const materialFilePayload = (files) => files.map((file) => ({
  id: file.id,
  name: file.originalName,
  originalName: file.originalName,
  contentType: file.contentType,
  bytes: file.bytes,
  url: `/api/material-files/${file.id}`,
  downloadUrl: `/api/material-files/${file.id}`
}));

export const buildStudentMaterialTasks = async (env, user) => {
  const { results } = await env.DB.prepare(
    `SELECT id,title,description,deadline,allowed_types_json AS allowedTypesJson,
            file_limit AS fileLimit,require_summary AS requireSummary,owner_type AS ownerType,status
       FROM material_tasks WHERE status='published' ORDER BY deadline`
  ).all();
  const taskIds = unique(results.map((task) => task.id));
  const needsTeam = results.some((task) => task.ownerType === 'team');
  const team = needsTeam ? await teamForUser(env, user.id) : null;
  const ownerPairs = [{ type: 'user', id: user.id }];
  if (team) ownerPairs.push({ type: 'team', id: team.id });
  const submissions = [];
  for (const taskChunk of chunks(taskIds, 70)) {
    const values = [...taskChunk];
    const ownerStart = taskChunk.length + 1;
    const ownerSql = ownerPairs.map((owner, index) => {
      const parameter = ownerStart + (index * 2);
      values.push(owner.type, owner.id);
      return `(owner_type=?${parameter} AND owner_id=?${parameter + 1})`;
    }).join(' OR ');
    const page = await env.DB.prepare(
      `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
              summary,status,version,submitted_at AS submittedAt,
              review_note AS reviewNote,updated_at AS updatedAt
         FROM material_submissions
        WHERE task_id IN (${placeholders(taskChunk.length)}) AND (${ownerSql})`
    ).bind(...values).all();
    submissions.push(...page.results);
  }
  const filesBySubmission = new Map();
  for (const idChunk of chunks(submissions.map((submission) => submission.id))) {
    const files = await env.DB.prepare(
      `SELECT id,submission_id AS submissionId,original_name AS originalName,
              content_type AS contentType,bytes
         FROM material_files
        WHERE submission_id IN (${placeholders(idChunk.length)})
        ORDER BY submission_id,created_at`
    ).bind(...idChunk).all();
    for (const file of files.results) {
      if (!filesBySubmission.has(file.submissionId)) filesBySubmission.set(file.submissionId, []);
      filesBySubmission.get(file.submissionId).push(file);
    }
  }
  const submissionsByOwnerTask = new Map();
  for (const submission of submissions) {
    submission.files = materialFilePayload(filesBySubmission.get(submission.id) || []);
    submissionsByOwnerTask.set(
      `${submission.taskId}|${submission.ownerType}|${submission.ownerId}`,
      submission
    );
  }
  const tasks = [];
  for (const task of results) {
    const owner = task.ownerType === 'team'
      ? (team ? { type: 'team', id: team.id } : null)
      : { type: 'user', id: user.id };
    const submission = owner
      ? submissionsByOwnerTask.get(`${task.id}|${owner.type}|${owner.id}`) || null
      : null;
    const allowedTypes = parseJson(task.allowedTypesJson, []);
    tasks.push({
      ...task,
      allowedTypes,
      fileTypes: allowedTypes.map((item) => item.replace(/^\./, '')),
      requireSummary: Boolean(task.requireSummary),
      submission
    });
  }
  return tasks;
};

export const buildTeamSummary = async (env, user, config) => {
  if (user.trackId !== 'interaction') return null;
  const [count, team] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first(),
    teamForUser(env, user.id)
  ]);
  let currentTeam = null;
  if (team) {
    const members = await membersForTeam(env, team.id);
    currentTeam = { ...team, members, memberCount: members.length };
  }
  return {
    teamCount: Number(count?.total || 0),
    maxTeams: Number(config.maxTeams || 50),
    team: currentTeam
  };
};

export const buildStudentDashboard = async (env, user, options = {}) => {
  const date = options.date || shanghaiDate();
  const config = options.config || await readConfig(env);
  const [teamSummary, taskResult, materialTasks] = await Promise.all([
    buildTeamSummary(env, user, config),
    buildStudentTasks(env, user, { config, date }),
    buildStudentMaterialTasks(env, user)
  ]);
  return {
    version: 1,
    user,
    config,
    tracks: TRACKS,
    date,
    time: shanghaiTime(),
    teamSummary,
    tasks: taskResult.tasks,
    materialTasks,
    switches: taskResult.switches
  };
};
