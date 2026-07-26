import { json, nowIso, requireUser, shanghaiDate } from '../lib/runtime.js';

let schemaReady;
const ensureInteractionSchema = (env) => {
  if (!schemaReady) schemaReady = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS image_variants (
      source_type TEXT NOT NULL, source_id TEXT NOT NULL, variant TEXT NOT NULL,
      object_key TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (source_type,source_id,variant))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS plaza_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL, deleted_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      actor_id TEXT, post_id TEXT, content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_plaza_comments_post_status_created ON plaza_comments(post_id,status,created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id,is_read,created_at DESC)')
  ]).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const postDetails = async (env, post, userId = null) => {
  const [members, images, counts, liked] = await Promise.all([
    env.DB.prepare(
    `SELECT u.id,u.name,u.student_id AS studentId,u.campus
       FROM team_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=?1 ORDER BY tm.joined_at`
    ).bind(post.teamId).all(),
    env.DB.prepare(
    `SELECT i.id,i.sort_order AS sortOrder
       FROM task_submission_images i WHERE i.submission_id=?1 ORDER BY i.sort_order`
    ).bind(post.submissionId).all(),
    env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM plaza_likes WHERE post_id=?1) AS likes,
       (SELECT COUNT(*) FROM plaza_views WHERE post_id=?1) AS views,
       (SELECT COUNT(*) FROM plaza_comments WHERE post_id=?1 AND status='visible') AS comments,
       (SELECT COUNT(*) FROM plaza_likes
         WHERE user_id=?2 AND date(liked_at,'+8 hours')=?3) AS userLikesToday`
    ).bind(post.id, userId || '', shanghaiDate()).first(),
    userId ? env.DB.prepare(
    'SELECT 1 AS liked FROM plaza_likes WHERE post_id=?1 AND user_id=?2'
    ).bind(post.id, userId).first() : Promise.resolve(null)
  ]);
  return {
    ...post,
    members: members.results,
    publisherName: members.results[0]?.name || post.teamName,
    images: images.results.map((item) => ({
      ...item,
      displayUrl: `/api/public-images/${item.id}`,
      highUrl: `/api/media/${item.id}`
    })),
    likeCount: Number(counts.likes),
    viewCount: Number(counts.views),
    commentCount: Number(counts.comments),
    likeQuota: { used: Number(counts.userLikesToday), remaining: Math.max(0, 5 - Number(counts.userLikesToday)) },
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
      && route !== '/api/inbox'
      && route !== '/api/admin/comments'
      && !/^\/api\/plaza\/[^/]+(?:\/(?:view|like|comments))?$/.test(route)
      && !/^\/api\/plaza\/[^/]+\/comments\/[^/]+$/.test(route)
      && !/^\/api\/admin\/comments\/[^/]+$/.test(route)) return null;
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
  await ensureInteractionSchema(env);

  if (route === '/api/plaza' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
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
          t.name AS teamName,task.name AS taskName,p.copy_text AS copy,p.published_at AS publishedAt
       FROM plaza_posts p JOIN teams t ON t.id=p.team_id
       JOIN task_submissions s ON s.id=p.submission_id JOIN tasks task ON task.id=s.task_id
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
              task.name AS taskName,p.copy_text AS copy,p.published_at AS publishedAt
         FROM plaza_posts p JOIN teams t ON t.id=p.team_id
         JOIN task_submissions s ON s.id=p.submission_id JOIN tasks task ON task.id=s.task_id
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

  const commentsMatch = route.match(/^\/api\/plaza\/([^/]+)\/comments$/);
  if (commentsMatch && request.method === 'GET') {
    const postId = decodeURIComponent(commentsMatch[1]);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 10)));
    const { results } = await env.DB.prepare(
      `SELECT c.id,c.content,c.created_at AS createdAt,u.id AS userId,u.name,u.student_id AS studentId
         FROM plaza_comments c JOIN users u ON u.id=c.user_id
        WHERE c.post_id=?1 AND c.status='visible'
        ORDER BY c.created_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(postId, limit, (page - 1) * limit).all();
    return json({
      comments: results.map((item) => ({
        ...item,
        canDelete: user.role === 'admin' || item.userId === user.id
      })),
      page,
      hasMore: results.length === limit
    });
  }

  if (commentsMatch && request.method === 'POST') {
    const postId = decodeURIComponent(commentsMatch[1]);
    const body = await request.json();
    const content = String(body.content || '').trim();
    if (!content) return json({ error: '请输入评论内容' }, 400);
    if (content.length > 500) return json({ error: '评论最多500字' }, 400);
    const post = await env.DB.prepare(
      `SELECT p.id,p.team_id AS teamId FROM plaza_posts p
        WHERE p.id=?1 AND p.status='visible'`
    ).bind(postId).first();
    if (!post) return json({ error: '作品不存在或已隐藏' }, 404);
    const recentCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM plaza_comments
        WHERE user_id=?1 AND created_at>datetime(?2,'-60 seconds') AND status='visible'`
    ).bind(user.id, nowIso()).first();
    if (Number(recentCount.count) >= 5) return json({ error: '评论过于频繁，请稍后再试' }, 429);
    const duplicate = await env.DB.prepare(
      `SELECT 1 FROM plaza_comments
        WHERE user_id=?1 AND post_id=?2 AND content=?3
          AND created_at>datetime(?4,'-5 minutes') AND status='visible'`
    ).bind(user.id, postId, content, nowIso()).first();
    if (duplicate) return json({ error: '请勿短时间重复发布相同评论' }, 409);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    await env.DB.prepare(
      `INSERT INTO plaza_comments (id,post_id,user_id,content,status,created_at)
       VALUES (?1,?2,?3,?4,'visible',?5)`
    ).bind(id, postId, user.id, content, createdAt).run();
    const owners = await env.DB.prepare(
      `SELECT DISTINCT user_id AS userId FROM team_members
        WHERE team_id=?1 AND user_id<>?2`
    ).bind(post.teamId, user.id).all();
    if (owners.results.length) {
      await env.DB.batch(owners.results.map((owner) => env.DB.prepare(
        `INSERT INTO notifications
          (id,user_id,type,actor_id,post_id,content,is_read,created_at)
         VALUES (?1,?2,'comment',?3,?4,?5,0,?6)`
      ).bind(crypto.randomUUID(), owner.userId, user.id, postId,
        `${user.name}评论了你的作品：${content.slice(0, 80)}`, createdAt)));
    }
    return json({
      comment: { id, content, createdAt, userId: user.id, name: user.name, canDelete: true },
      commentCount: Number((await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM plaza_comments WHERE post_id=?1 AND status='visible'"
      ).bind(postId).first()).count)
    }, 201);
  }

  const deleteCommentMatch = route.match(/^\/api\/plaza\/([^/]+)\/comments\/([^/]+)$/);
  if (deleteCommentMatch && request.method === 'DELETE') {
    const postId = decodeURIComponent(deleteCommentMatch[1]);
    const commentId = decodeURIComponent(deleteCommentMatch[2]);
    const comment = await env.DB.prepare(
      'SELECT user_id AS userId FROM plaza_comments WHERE id=?1 AND post_id=?2 AND status=\'visible\''
    ).bind(commentId, postId).first();
    if (!comment) return json({ error: '评论不存在或已删除' }, 404);
    if (user.role !== 'admin' && comment.userId !== user.id) return json({ error: '只能删除自己的评论' }, 403);
    await env.DB.prepare(
      "UPDATE plaza_comments SET status='deleted',deleted_at=?1 WHERE id=?2"
    ).bind(nowIso(), commentId).run();
    return json({ ok: true });
  }

  if (route === '/api/inbox' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const { results } = await env.DB.prepare(
      `SELECT n.id,n.type,n.content,n.post_id AS postId,n.is_read AS isRead,
              n.created_at AS createdAt,a.name AS actorName
         FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
        WHERE n.user_id=?1 ORDER BY n.created_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(user.id, limit, (page - 1) * limit).all();
    const unread = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id=?1 AND is_read=0'
    ).bind(user.id).first();
    return json({ notifications: results, unread: Number(unread.count), page, hasMore: results.length === limit });
  }

  if (route === '/api/inbox' && request.method === 'PATCH') {
    const body = await request.json();
    if (body.id) {
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE id=?1 AND user_id=?2')
        .bind(String(body.id), user.id).run();
    } else {
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?1').bind(user.id).run();
    }
    return json({ ok: true });
  }

  if (route === '/api/admin/comments' && request.method === 'GET') {
    if (user.role !== 'admin') return json({ error: '无管理员权限' }, 403);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const { results } = await env.DB.prepare(
      `SELECT c.id,c.content,c.created_at AS createdAt,u.name AS userName,
              p.id AS postId,t.name AS teamName
         FROM plaza_comments c JOIN users u ON u.id=c.user_id
         JOIN plaza_posts p ON p.id=c.post_id JOIN teams t ON t.id=p.team_id
        WHERE c.status='visible' ORDER BY c.created_at DESC LIMIT ?1 OFFSET ?2`
    ).bind(limit, (page - 1) * limit).all();
    return json({ comments: results, page, hasMore: results.length === limit });
  }

  const adminDeleteComment = route.match(/^\/api\/admin\/comments\/([^/]+)$/);
  if (adminDeleteComment && request.method === 'DELETE') {
    if (user.role !== 'admin') return json({ error: '无管理员权限' }, 403);
    await env.DB.prepare(
      "UPDATE plaza_comments SET status='deleted',deleted_at=?1 WHERE id=?2 AND status='visible'"
    ).bind(nowIso(), decodeURIComponent(adminDeleteComment[1])).run();
    return json({ ok: true });
  }

  return null;
};
