const TRACKS = [
  { id: 'interaction', name: '四校区互动赛道' },
  { id: 'health', name: '自律健康赛道' }
];

const USER_STATUSES = ['active', 'disabled'];
const DEFAULT_MAX_TEAMS = 50;
const TASK_STATUSES = ['draft', 'published', 'closed', 'archived'];
const SUBMISSION_STATUSES = ['draft', 'submitted', 'returned', 'approved'];

function migratePhase1(data, now = new Date().toISOString()) {
  let changed = false;
  if (!Array.isArray(data.tracks) || JSON.stringify(data.tracks) !== JSON.stringify(TRACKS)) {
    data.tracks = TRACKS.map((track) => ({ ...track }));
    changed = true;
  }
  if (!Array.isArray(data.users)) {
    data.users = [];
    changed = true;
  }
  for (const user of data.users) {
    const defaults = {
      campus: '',
      trackId: user.role === 'admin' ? null : 'health',
      status: 'active',
      createdAt: now
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (user[key] === undefined) {
        user[key] = value;
        changed = true;
      }
    }
  }
  return changed;
}

function migratePhase2(data) {
  let changed = false;
  if (!data.config || typeof data.config !== 'object') {
    data.config = {};
    changed = true;
  }
  if (!Number.isInteger(data.config.maxTeams) || data.config.maxTeams < 0) {
    data.config.maxTeams = DEFAULT_MAX_TEAMS;
    changed = true;
  }
  if (!Array.isArray(data.teams)) {
    data.teams = [];
    changed = true;
  }
  return changed;
}

function migratePhase3(data) {
  let changed = false;
  if (!Array.isArray(data.tasks)) {
    data.tasks = [];
    changed = true;
  }
  if (!data.config || typeof data.config !== 'object') data.config = {};
  if (typeof data.config.activityEnabled !== 'boolean') {
    data.config.activityEnabled = true;
    changed = true;
  }
  if (!data.config.trackEnabled || typeof data.config.trackEnabled !== 'object') {
    data.config.trackEnabled = { interaction: true, health: true };
    changed = true;
  } else {
    for (const track of TRACKS) {
      if (typeof data.config.trackEnabled[track.id] !== 'boolean') {
        data.config.trackEnabled[track.id] = true;
        changed = true;
      }
    }
  }
  return changed;
}

function migratePhase4(data) {
  let changed = false;
  if (!Array.isArray(data.taskSubmissions)) {
    data.taskSubmissions = [];
    changed = true;
  }
  for (const submission of data.taskSubmissions) {
    if (!Number.isInteger(submission.version) || submission.version < 1) {
      submission.version = 1;
      changed = true;
    }
  }
  return changed;
}

function migratePhase5(data) {
  let changed = false;
  if (!Array.isArray(data.plazaPosts)) {
    data.plazaPosts = [];
    changed = true;
  }
  for (const post of data.plazaPosts) {
    if (!Array.isArray(post.likedBy)) {
      post.likedBy = [];
      changed = true;
    }
    if (!Number.isInteger(post.viewCount) || post.viewCount < 0) {
      post.viewCount = 0;
      changed = true;
    }
    if (!['visible', 'hidden'].includes(post.status)) {
      post.status = 'visible';
      changed = true;
    }
  }
  return changed;
}

function migratePhase6(data, now = new Date().toISOString()) {
  let changed = false;
  if (!Array.isArray(data.plazaLikes)) {
    data.plazaLikes = [];
    changed = true;
    for (const post of data.plazaPosts || []) {
      for (const userId of post.likedBy || []) {
        if (!data.plazaLikes.some((like) => like.postId === post.id && like.userId === userId)) {
          data.plazaLikes.push({ postId: post.id, userId, likedAt: now });
        }
      }
    }
  }
  if (!Array.isArray(data.plazaViews)) {
    data.plazaViews = [];
    changed = true;
  }
  return changed;
}

function migratePhase7(data) {
  let changed = false;
  if (!Array.isArray(data.rankingFreezes)) {
    data.rankingFreezes = [];
    changed = true;
  }
  for (const post of data.plazaPosts || []) {
    if (typeof post.excludedFromRanking !== 'boolean') {
      post.excludedFromRanking = false;
      changed = true;
    }
  }
  return changed;
}

function migratePhase9(data) {
  let changed = false;
  if (!Array.isArray(data.materialTasks)) {
    data.materialTasks = [];
    changed = true;
  }
  if (!Array.isArray(data.materialSubmissions)) {
    data.materialSubmissions = [];
    changed = true;
  }
  for (const submission of data.materialSubmissions) {
    if (!Number.isInteger(submission.version) || submission.version < 1) {
      submission.version = 1;
      changed = true;
    }
  }
  return changed;
}

function migratePhase10(data) {
  let changed = false;
  if (!data.config || typeof data.config !== 'object') data.config = {};
  if (typeof data.config.allowSelfJoin !== 'boolean') {
    data.config.allowSelfJoin = false;
    changed = true;
  }
  for (const task of data.tasks || []) {
    if (!['oneTime', 'weekly', 'activityDays'].includes(task.scheduleType)) {
      task.scheduleType = 'oneTime';
      changed = true;
    }
  }
  for (const submission of data.taskSubmissions || []) {
    if (submission.occurrenceDate === undefined) {
      submission.occurrenceDate = null;
      changed = true;
    }
    if (submission.plazaCopy === undefined) {
      submission.plazaCopy = submission.copy || '';
      changed = true;
    }
  }
  return changed;
}

function migratePhase11(data) {
  let changed = false;
  if (!Array.isArray(data.memberCheckins)) {
    data.memberCheckins = [];
    changed = true;
  }
  for (const team of data.teams || []) {
    if (team.captainId === undefined) {
      team.captainId = null;
      changed = true;
    }
  }
  return changed;
}

function migrateData(data, now = new Date().toISOString()) {
  let changed = migratePhase1(data, now);
  if (migratePhase2(data)) changed = true;
  if (migratePhase3(data)) changed = true;
  if (migratePhase4(data)) changed = true;
  if (migratePhase5(data)) changed = true;
  if (migratePhase6(data, now)) changed = true;
  if (migratePhase7(data)) changed = true;
  if (migratePhase9(data)) changed = true;
  if (migratePhase10(data)) changed = true;
  if (migratePhase11(data)) changed = true;
  if (!Array.isArray(data.checkins)) {
    data.checkins = [];
    changed = true;
  }
  return changed;
}

function safeUser(user) {
  if (!user) return null;
  const { password, ...profile } = user;
  return profile;
}

function trackIdFromValue(value) {
  const normalized = String(value || '').trim();
  const track = TRACKS.find((item) => item.id === normalized || item.name === normalized);
  return track ? track.id : null;
}

function statusFromValue(value, fallback = 'active') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['active', '启用', '正常'].includes(normalized)) return 'active';
  if (['disabled', '禁用', '停用'].includes(normalized)) return 'disabled';
  return fallback;
}

module.exports = {
  TRACKS,
  USER_STATUSES,
  DEFAULT_MAX_TEAMS,
  TASK_STATUSES,
  SUBMISSION_STATUSES,
  migratePhase1,
  migratePhase2,
  migratePhase3,
  migratePhase4,
  migratePhase5,
  migratePhase6,
  migratePhase7,
  migratePhase9,
  migratePhase10,
  migratePhase11,
  migrateData,
  safeUser,
  trackIdFromValue,
  statusFromValue
};
