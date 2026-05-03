// api/fb/history.js — current user 的發文歷史
// GET ?limit=50&status=posted + Authorization: Bearer <idToken>
// → { posts: [...], count }

import { getFirestore, verifyIdToken, getIdTokenFromReq } from '../_lib/admin.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_STATUS = new Set(['posted', 'scheduled', 'failed']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminEmails.includes(decoded.email)) {
      return res.status(403).json({ error: '尚未開放', reason: 'notAdmin' });
    }

    const limit = Math.min(parseInt(req.query.limit || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const status = String(req.query.status || '').trim();

    const db = getFirestore();
    let query = db.collection('fb_posts')
      .where('user_uid', '==', decoded.uid);
    if (status && ALLOWED_STATUS.has(status)) {
      query = query.where('status', '==', status);
    }
    query = query.orderBy('posted_at', 'desc').limit(limit);

    const snap = await query.get();
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    return res.status(200).json({ posts, count: posts.length });
  } catch (err) {
    console.error('[fb/history] error:', err);
    // Firestore 第一次 query 可能會說「需要 composite index」, 訊息含建立連結
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
