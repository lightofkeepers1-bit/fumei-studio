// api/fb/post.js — 對 current user 自己的粉專發文 (3 種模式都走這個)
// POST + Authorization: Bearer <idToken>
// Body: { posts: [{ page_id, message?, image_url?, scheduled_at? }, ...] }
//   - 1 個 element  = 單發
//   - N 個 element  = 多發 (內容可同可不同, 前端決定)
//   - scheduled_at  = unix epoch seconds (10 分鐘後 ~ 6 個月內), 無則立即發
// → { results: [{ page_id, page_name, ok, fb_post_id?, status?, error? }] }

import { getFirestore, verifyIdToken, getIdTokenFromReq } from '../_lib/admin.js';
import { postText, postPhoto, FBError } from '../_lib/fb.js';

const MAX_POSTS_PER_REQ = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const idToken = getIdTokenFromReq(req);
    if (!idToken) return res.status(401).json({ error: '未登入', reason: 'noAuth' });

    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (e) {
      if (e.name === 'AdminMisconfiguredError') {
        return res.status(500).json({ error: '伺服器設定錯誤', reason: 'serverMisconfigured' });
      }
      return res.status(401).json({ error: '身份驗證失敗', reason: 'invalidToken' });
    }
    const uid = decoded.uid;

    // Phase 1 admin gate ── Phase 2 OAuth 開放後刪掉 ──
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminEmails.includes(decoded.email)) {
      return res.status(403).json({ error: '尚未開放', reason: 'notAdmin' });
    }

    const posts = req.body?.posts;
    if (!Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: 'posts 必須是非空陣列', reason: 'badPosts' });
    }
    if (posts.length > MAX_POSTS_PER_REQ) {
      return res.status(400).json({ error: `一次最多 ${MAX_POSTS_PER_REQ} 篇`, reason: 'tooMany' });
    }

    const db = getFirestore();
    const userPagesSnap = await db.collection('fb_user_pages').doc(uid).get();
    if (!userPagesSnap.exists) {
      return res.status(400).json({ error: '尚未連結 FB 粉專', reason: 'noConnection' });
    }
    const userPages = userPagesSnap.data().pages || [];
    const pageMap = Object.fromEntries(userPages.map(p => [p.id, p]));

    const results = [];
    for (const item of posts) {
      const page_id = String(item?.page_id || '');
      const message = String(item?.message || '');
      const image_url = item?.image_url ? String(item.image_url) : null;
      const scheduled_at = item?.scheduled_at ? parseInt(item.scheduled_at, 10) : null;

      const page = pageMap[page_id];
      if (!page) {
        results.push({ page_id, ok: false, error: '不在你的粉專列表' });
        continue;
      }
      if (!message && !image_url) {
        results.push({ page_id, page_name: page.name, ok: false, error: 'message 或 image_url 至少要一個' });
        continue;
      }
      if (image_url && !image_url.startsWith('https://')) {
        results.push({ page_id, page_name: page.name, ok: false, error: 'image_url 必須是 https' });
        continue;
      }
      if (scheduled_at) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (scheduled_at < nowSec + 600) {
          results.push({ page_id, page_name: page.name, ok: false, error: '排程時間必須 10 分鐘以上' });
          continue;
        }
        if (scheduled_at > nowSec + 60 * 60 * 24 * 180) {
          results.push({ page_id, page_name: page.name, ok: false, error: '排程時間最多 6 個月' });
          continue;
        }
      }

      const status = scheduled_at ? 'scheduled' : 'posted';
      const now = new Date().toISOString();

      try {
        const fbResult = image_url
          ? await postPhoto(page.id, page.token, image_url, message, scheduled_at)
          : await postText(page.id, page.token, message, scheduled_at);

        const fbPostId = fbResult.post_id || fbResult.id;

        await db.collection('fb_posts').add({
          user_uid: uid,
          user_email: decoded.email,
          page_id: page.id,
          page_name: page.name,
          message,
          image_url,
          fb_post_id: fbPostId,
          status,
          posted_at: now,
          scheduled_at: scheduled_at ? new Date(scheduled_at * 1000).toISOString() : null,
        });

        results.push({
          page_id: page.id,
          page_name: page.name,
          ok: true,
          fb_post_id: fbPostId,
          status,
        });
      } catch (e) {
        const errMsg = e instanceof FBError ? e.message : (e.message || String(e));

        await db.collection('fb_posts').add({
          user_uid: uid,
          user_email: decoded.email,
          page_id: page.id,
          page_name: page.name,
          message,
          image_url,
          status: 'failed',
          error_msg: errMsg,
          posted_at: now,
        });

        results.push({
          page_id: page.id,
          page_name: page.name,
          ok: false,
          error: errMsg,
        });
      }
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('[fb/post] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
