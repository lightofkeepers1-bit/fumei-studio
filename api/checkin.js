// api/checkin.js — 每日簽到（伺服器端）
// POST + Authorization: Bearer <ID token>
// → 檢查今天是否已簽到 → 未簽到則加 3 點
// 回傳 { ok, creditsAdded, newBalance } 或 { error, reason }

import { getFirestore, verifyIdToken, getIdTokenFromReq } from './_lib/admin.js';

const DAILY_BONUS = 3;

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
        console.error('[checkin] admin misconfigured:', e.message);
        return res.status(500).json({ error: '伺服器設定錯誤', reason: 'serverMisconfigured' });
      }
      return res.status(401).json({ error: '身份驗證失敗', reason: 'invalidToken' });
    }
    const uid = decoded.uid;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const db = getFirestore();

    const result = await db.runTransaction(async (tx) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      const data = userSnap.exists ? userSnap.data() : {};
      const lastCheckin = data.fumei_checkin_last || '';
      if (lastCheckin === today) {
        return { ok: false, reason: 'alreadyCheckedIn', error: '今天已經簽到過了' };
      }
      const currentCredits = parseInt(data.fumei_credits || 0, 10);
      const newBalance = currentCredits + DAILY_BONUS;
      if (userSnap.exists) {
        tx.update(userRef, {
          fumei_credits: newBalance,
          fumei_checkin_last: today,
        });
      } else {
        tx.set(userRef, {
          fumei_credits: newBalance,
          fumei_checkin_last: today,
        }, { merge: true });
      }
      return { ok: true, creditsAdded: DAILY_BONUS, newBalance };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[checkin] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
