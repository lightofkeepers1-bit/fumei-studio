// api/fb/pages.js — 回傳 current user 的粉專清單 (token 不外露給前端)
// GET + Authorization: Bearer <idToken>
// → { pages: [{ name, id, added_at }, ...], connected, connected_at }
//
// Phase 1: admin gate; Phase 2 移除 admin gate, 任何登入用戶都能用 (前提是有 OAuth 連結過)

import { getFirestore, verifyIdToken, getIdTokenFromReq } from '../_lib/admin.js';

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

    // Phase 1 admin gate ── Phase 2 OAuth 開放後刪掉這 4 行 ──
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminEmails.includes(decoded.email)) {
      return res.status(403).json({ error: '尚未開放', reason: 'notAdmin' });
    }

    const db = getFirestore();
    const snap = await db.collection('fb_user_pages').doc(decoded.uid).get();
    if (!snap.exists) {
      return res.status(200).json({ pages: [], connected: false });
    }
    const data = snap.data();
    return res.status(200).json({
      pages: (data.pages || []).map(p => ({
        name: p.name,
        id: p.id,
        added_at: p.added_at,
        // token 故意不傳到前端
      })),
      connected: true,
      connected_at: data.connected_at,
    });
  } catch (err) {
    console.error('[fb/pages] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
