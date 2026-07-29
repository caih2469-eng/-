import {
  hasMakeupPermission,
  parseJson,
  readConfig,
  shanghaiDate,
  shanghaiTime,
  TRACKS
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';

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
  const { results } = await env.DB.prepare(
    `SELECT i.id,COALESCE(m.object_key,i.object_key) AS objectKey,
            i.content_type AS contentType,i.bytes,
            i.sort_order AS sortOrder,m.id AS mediaId,
            tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey,
            tm.mime_type AS thumbContentType,tm.file_size AS thumbBytes
       FROM task_submission_images i
       LEFT JOIN media_objects m ON m.id=i.id
       LEFT JOIN media_objects tm ON tm.business_id=m.id
        AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
      WHERE i.submission_id=?1 ORDER BY i.sort_order`
  ).bind(submissionId).all();
  return Promise.all(results.map(async (item) => {
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
  }));
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
  const tasks = [];
  const today = options.date || shanghaiDate();
  const makeupAllowed = user.role === 'student'
    ? await hasMakeupPermission(env, user.id, today) : false;
  for (const task of results) {
    if (task.scheduleJson && !isTaskOccurrence(task, today)) continue;
    const owner = user.role === 'admin' ? null : await submissionOwner(env, user, task).catch(() => null);
    const occurrenceDate = task.scheduleJson ? today : '';
    const submission = owner ? await env.DB.prepare(
      `SELECT id,copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
              is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
              submitted_at AS submittedAt,review_note AS reviewNote
         FROM task_submissions
        WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3 AND occurrence_date=?4 LIMIT 1`
    ).bind(task.id, owner.type, owner.id, occurrenceDate).first() : null;
    if (submission) submission.images = await submissionImages(env, submission.id, user);
    const schedule = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};
    let teamProgress = null;
    let memberCheckin = null;
    let isCaptain = false;
    if (owner?.team) {
      const members = await membersForTeam(env, owner.team.id);
      const checkins = await env.DB.prepare(
        `SELECT user_id AS userId,id FROM member_checkins
          WHERE team_id=?1 AND task_id=?2 AND occurrence_date=?3`
      ).bind(owner.team.id, task.id, occurrenceDate).all();
      teamProgress = {
        total: members.length,
        completed: checkins.results.length,
        members: members.map((member) => ({
          ...member,
          checked: checkins.results.some((item) => item.userId === member.id)
        }))
      };
      memberCheckin = checkins.results.find((item) => item.userId === user.id) || null;
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
  const tasks = [];
  for (const task of results) {
    let owner = { type: 'user', id: user.id };
    if (task.ownerType === 'team') {
      const team = await teamForUser(env, user.id);
      owner = team ? { type: 'team', id: team.id } : null;
    }
    const submission = owner ? await env.DB.prepare(
      `SELECT id,summary,status,version,submitted_at AS submittedAt,review_note AS reviewNote,updated_at AS updatedAt
         FROM material_submissions WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3 LIMIT 1`
    ).bind(task.id, owner.type, owner.id).first() : null;
    if (submission) {
      const files = await env.DB.prepare(
        `SELECT id,original_name AS originalName,content_type AS contentType,bytes
           FROM material_files WHERE submission_id=?1 ORDER BY created_at`
      ).bind(submission.id).all();
      submission.files = materialFilePayload(files.results);
    }
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
