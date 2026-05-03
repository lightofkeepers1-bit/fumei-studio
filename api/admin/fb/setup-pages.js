// api/admin/fb/setup-pages.js — admin 一次性匯入自己的 FB 粉專 token
// POST + Authorization: Bearer <admin idToken>
// Body: { pages: [{ name, id, token }] }
// → 寫到 fb_user_pages/{uid}, 之後發文 API 從這邊讀
//
// 為什麼要走這個 endpoint 而不是直接塞 Firestore Console:
//  1. 重複用 (token 過期重設方便)
//  2. 同一個 admin auth pattern, 未來要轉成多用戶 OAuth 也只是換來源, downstream 不變

import { getFirestore, verifyIdToken, getIdTokenFromReq } from '../../_lib/admin.js';

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
        console.error('[setup-pages] admin misconfigured:', e.message);
        return res.status(500).json({ error: '伺服器設定錯誤', reason: 'serverMisconfigured' });
      }
      return res.status(401).json({ error: '身份驗證失敗', reason: 'invalidToken' });
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminEmails.includes(decoded.email)) {
      return res.status(403).json({ error: '非管理員', reason: 'notAdmin' });
    }

    const pages = req.body?.pages;
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages 必須是非空陣列', reason: 'badPages' });
    }
    if (pages.length > 50) {
      return res.status(400).json({ error: '最多 50 個粉專', reason: 'tooMany' });
    }
    for (const p of pages) {
      if (!p?.id || !p?.token || !p?.name) {
        return res.status(400).json({ error: '每個粉專必須有 id, token, name', reason: 'badPage' });
      }
    }

    const db = getFirestore();
    const now = new Date().toISOString();
    await db.collection('fb_user_pages').doc(decoded.uid).set({
      pages: pages.map(p => ({
        name: String(p.name),
        id: String(p.id),
        token: String(p.token),
        added_at: now,
      })),
      connected_at: now,
      connected_by_email: decoded.email,
    });

    return res.status(200).json({ ok: true, count: pages.length });
  } catch (err) {
    console.error('[setup-pages] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
