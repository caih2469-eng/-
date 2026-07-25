import { json, nowIso, requireUser, shanghaiDate } from '../lib/runtime.js';

const postDetails = async (env, post, userId = null) => {
  const members = await env.DB.prepare(
    `SELECT u.id,u.name,u.student_id AS studentId,u.campus
       FROM team_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=?1 ORDER BY tm.joined_at`
  ).bind(post.teamId).all();
  const images = await env.DB.prepare(
    `SELECT i.id,i.sort_order AS sortOrder
       FROM task_submission_images i WHERE i.submission_id=?1 ORDER BY i.sort_order`
  ).bind(post.submissionId).all();
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM plaza_likes WHERE post_id=?1) AS likes,
       (SELECT COUNT(*) FROM plaza_views WHERE post_id=?1) AS views`
  ).bind(post.id).first();
  const liked = userId ? await env.DB.prepare(
    'SELECT 1 AS liked FROM plaza_likes WHERE post_id=?1 AND user_id=?2'
  ).bind(post.id, userId).first() : null;
  return {
    ...post,
    members: members.results,
    images: images.results.map((item) => ({ ...item, url: `/api/files/${item.id}` })),
    likeCount: Number(counts.likes),
    viewCount: Number(counts.views),
    liked: Boolean(liked)
  };
};

const periodBounds = (period, key) => {
  const today = shanghaiDate();
  if (period === 'month') {
    const month = /^\d{4}-\d{2}$/.test(key || '') ? key : today.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    return { start: `${month}-01`, end, key: month };
  }
  if (period === 'week') {
    const base = new Date(`${today}T00:00:00+08:00`);
    const day = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - day);
    const start = base.toISOString().slice(0, 10);
    base.setUTCDate(base.getUTCDate() + 7);
    return { start, end: base.toISOString().slice(0, 10), key: start };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(key || '') ? key : today;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: date, end: next.toISOString().slice(0, 10), key: date };
};

export const calculateRankings = async (env, period, key) => {
  const bounds = periodBounds(period, key);
  if (period === 'month') {
    const frozen = await env.DB.prepare(
      'SELECT snapshot_json AS snapshotJson,frozen_at AS frozenAt FROM ranking_freezes WHERE period=?1'
    ).bind(bounds.key).first();
    if (frozen) return { period, key: bounds.key, frozen: true, frozenAt: frozen.frozenAt, ...JSON.parse(frozen.snapshotJson) };
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id AS teamId,t.name AS teamName,
       COUNT(DISTINCT p.id) AS publicCount,
       COUNT(DISTINCT l.post_id || ':' || l.user_id) AS likes,
       COUNT(DISTINCT v.id) AS views
     FROM teams t
     LEFT JOIN plaza_posts p ON p.team_id=t.id AND p.status='visible'
       AND p.excluded_from_ranking=0 AND date(p.published_at,'+8 hours')>=?1
       AND date(p.published_at,'+8 hours')<?2
     LEFT JOIN plaza_likes l ON l.post_id=p.id
       AND date(l.liked_at,'+8 hours')>=?1 AND date(l.liked_at,'+8 hours')<?2
     LEFT JOIN plaza_views v ON v.post_id=p.id
       AND date(v.viewed_at,'+8 hours')>=?1 AND date(v.viewed_at,'+8 hours')<?2
     GROUP BY t.id,t.name`
  ).bind(bounds.start, bounds.end).all();
  const maxLikes = Math.max(0, ...results.map((item) => Number(item.likes)));
  const maxViews = Math.max(0, ...results.map((item) => Number(item.views)));
  const ranked = results.map((item) => ({
    teamId: item.teamId,
    teamName: item.teamName,
    publicCount: Number(item.publicCount),
    likes: Number(item.likes),
    views: Number(item.views),
    score: Number(((maxLikes ? Number(item.likes) / maxLikes : 0) * 70
      + (maxViews ? Number(item.views) / maxViews : 0) * 30).toFixed(4))
  })).sort((a, b) => b.score - a.score || b.likes - a.likes || b.views - a.views)
    .map((item, index) => ({ rank: index + 1, ...item }));
  return {
    period,
    key: bounds.key,
    frozen: false,
    likes: [...ranked].sort((a, b) => b.likes - a.likes).map((item, index) => ({ ...item, rank: index + 1 })),
    views: [...ranked].sort((a, b) => b.views - a.views).map((item, index) => ({ ...item, rank: index + 1 })),
    heat: ranked,
    teams: ranked
  };
};

export const handlePlazaRoutes = async (request, env, ctx, url) => {
  const route = url.pathname;
  if (route !== '/api/rankings'
      && route !== '/api/plaza'
      && !/^\/api\/plaza\/[^/]+(?:\/(?:view|like))?$/.test(route)) return null;
  if (route === '/api/rankings' && request.method === 'GET') {
    const period = ['day', 'week', 'month'].includes(url.searchParams.get('period'))
      ? url.searchParams.get('period') : 'day';
    const cacheKey = new Request(`${url.origin}${route}?period=${period}&key=${url.searchParams.get('key') || ''}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
    const response = json(await calculateRankings(env, period, url.searchParams.get('key')), 200, {
      'cache-control': 'public, max-age=60',
      'cdn-cache-control': 'public, max-age=60'
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  }

  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;

  if (route === '/api/plaza' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit') || 6)));
    const sort = url.searchParams.get('sort') || 'latest';
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
      ? url.searchParams.get('month') : shanghaiDate().slice(0, 7);
    const order = sort === 'hot'
      ? '(SELECT COUNT(*) FROM plaza_likes WHERE post_id=p.id) + (SELECT COUNT(*) FROM plaza_views WHERE post_id=p.id) DESC'
      : 'p.published_at DESC';
    const monthFilter = sort === 'monthly'
      ? "AND strftime('%Y-%m',p.published_at,'+8 hours')=?1" : '';
    const params = sort === 'monthly' ? [month, limit, (page - 1) * limit] : [limit, (page - 1) * limit];
    const query = `SELECT p.id,p.submission_id AS submissionId,p.team_id AS teamId,
          t.name AS teamName,p.copy_text AS copy,p.published_at AS publishedAt
       FROM plaza_posts p JOIN teams t ON t.id=p.team_id
      WHERE p.status='visible' ${monthFilter} ORDER BY ${order}
      LIMIT ?${params.length - 1} OFFSET ?${params.length}`;
    const { results } = await env.DB.prepare(query).bind(...params).all();
    const posts = [];
    for (const post of results) posts.push(await postDetails(env, post, user.id));
    return json({ posts, page, limit, hasMore: posts.length === limit });
  }

  const detailMatch = route.match(/^\/api\/plaza\/([^/]+)$/);
  if (detailMatch && request.method === 'GET') {
    const post = await env.DB.prepare(
      `SELECT p.id,p.submission_id AS submissionId,p.team_id AS teamId,t.name AS teamName,
              p.copy_text AS copy,p.published_at AS publishedAt
         FROM plaza_posts p JOIN teams t ON t.id=p.team_id
        WHERE p.id=?1 AND p.status='visible'`
    ).bind(decodeURIComponent(detailMatch[1])).first();
    return post ? json({ post: await postDetails(env, post, user.id) }) : json({ error: '作品不存在' }, 404);
  }

  const viewMatch = route.match(/^\/api\/plaza\/([^/]+)\/view$/);
  if (viewMatch && request.method === 'POST') {
    if (user.role === 'admin') return json({ ok: true, counted: false });
    const postId = decodeURIComponent(viewMatch[1]);
    const exists = await env.DB.prepare("SELECT 1 FROM plaza_posts WHERE id=?1 AND status='visible'").bind(postId).first();
    if (!exists) return json({ error: '作品不存在' }, 404);
    const result = await env.DB.prepare(
      `INSERT INTO plaza_views (id,post_id,user_id,window_started_at,viewed_at)
       SELECT ?1,?2,?3,?4,?4 WHERE NOT EXISTS (
         SELECT 1 FROM plaza_views WHERE post_id=?2 AND user_id=?3
          AND viewed_at>datetime(?4,'-24 hours')
       )`
    ).bind(crypto.randomUUID(), postId, user.id, nowIso()).run();
    return json({ ok: true, counted: Boolean(result.meta.changes) });
  }

  const likeMatch = route.match(/^\/api\/plaza\/([^/]+)\/like$/);
  if (likeMatch && request.method === 'POST') {
    if (user.role === 'admin') return json({ error: '管理员不参与点赞' }, 403);
    const postId = decodeURIComponent(likeMatch[1]);
    const body = await request.json();
    if (body.liked === false) {
      await env.DB.prepare('DELETE FROM plaza_likes WHERE post_id=?1 AND user_id=?2').bind(postId, user.id).run();
      return json({ ok: true, liked: false });
    }
    const result = await env.DB.prepare(
      `INSERT INTO plaza_likes (post_id,user_id,liked_at)
       SELECT ?1,?2,?3 WHERE EXISTS (
         SELECT 1 FROM plaza_posts WHERE id=?1 AND status='visible'
       ) AND (
         SELECT COUNT(*) FROM plaza_likes
          WHERE user_id=?2 AND date(liked_at,'+8 hours')=?4
       ) < 5
       ON CONFLICT(post_id,user_id) DO NOTHING`
    ).bind(postId, user.id, nowIso(), shanghaiDate()).run();
    if (!result.meta.changes) {
      const already = await env.DB.prepare(
        'SELECT 1 FROM plaza_likes WHERE post_id=?1 AND user_id=?2'
      ).bind(postId, user.id).first();
      if (!already) return json({ error: '今天最多点赞 5 个作品' }, 429);
    }
    return json({ ok: true, liked: true });
  }

  return null;
};
