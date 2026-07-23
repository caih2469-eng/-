const TRACKS = [
  { id: 'interaction', name: '四校区互动赛道' },
  { id: 'health', name: '自律健康赛道' }
];

const USER_STATUSES = ['active', 'disabled'];

function migrateData(data, now = new Date().toISOString()) {
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
  migrateData,
  safeUser,
  trackIdFromValue,
  statusFromValue
};
