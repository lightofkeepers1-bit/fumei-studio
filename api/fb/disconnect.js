// api/fb/disconnect.js — 移除 current user 的 FB 連結 (data deletion)
// POST + Authorization: Bearer <idToken>
// → { ok }
// 注意: 只刪 token, fb_posts 歷史保留 (審計用). Phase 2 法務若要求全刪, 加 ?purge=true 處理.

import { getFirestore, verifyIdToken, getIdTokenFromReq } from '../_lib/admin.js';

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

    const db = getFirestore();
    await db.collection('fb_user_pages').doc(decoded.uid).delete();

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[fb/disconnect] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
