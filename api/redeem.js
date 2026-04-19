// api/redeem.js — 邀請碼兌換（伺服器端，繞過 Firestore rules）
// POST { code } + Authorization: Bearer <ID token>
// → 驗證碼有效 → 原子性：標記使用 + 加點數
// 回傳 { ok, creditsAdded, newBalance } 或 { error, reason }

import { getFirestore, verifyIdToken, getIdTokenFromReq } from './_lib/admin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. 驗證使用者身份
    const idToken = getIdTokenFromReq(req);
    if (!idToken) return res.status(401).json({ error: '未登入', reason: 'noAuth' });
    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: '身份驗證失敗', reason: 'invalidToken' });
    }
    const uid = decoded.uid;
    const email = decoded.email || '';

    // 2. 驗證邀請碼格式
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,20}$/.test(code)) {
      return res.status(400).json({ error: '邀請碼格式錯誤', reason: 'invalidCode' });
    }

    const db = getFirestore();

    // 3. 原子性交易：驗證碼 + 標記 + 加點
    const result = await db.runTransaction(async (tx) => {
      const codeRef = db.collection('invite_codes').doc(code);
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) {
        return { ok: false, reason: 'notFound', error: '❌ 查無此邀請碼' };
      }
      const codeData = codeSnap.data();
      if (codeData.used_by && codeData.used_by !== '') {
        return { ok: false, reason: 'alreadyUsed', error: '⚠️ 此邀請碼已被使用' };
      }
      if (codeData.active === false) {
        return { ok: false, reason: 'inactive', error: '⚠️ 此邀請碼已停用' };
      }
      const creditsToAdd = parseInt(codeData.credits || 0, 10);
      if (creditsToAdd <= 0 || creditsToAdd > 10000) {
        return { ok: false, reason: 'badCredits', error: '邀請碼設定有誤' };
      }

      // 讀取使用者目前點數
      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      const currentCredits = userSnap.exists ? (userSnap.data().fumei_credits || 0) : 0;
      const newBalance = currentCredits + creditsToAdd;

      // 原子寫入兩份文件
      tx.update(codeRef, {
        used_by: email || uid,
        used_uid: uid,
        used_at: new Date().toISOString(),
        active: false,
      });
      if (userSnap.exists) {
        tx.update(userRef, {
          fumei_credits: newBalance,
          [`fumei_credits_redeem_${Date.now()}`]: {
            code,
            amount: creditsToAdd,
            at: new Date().toISOString(),
          },
        });
      } else {
        tx.set(userRef, {
          fumei_credits: newBalance,
          [`fumei_credits_redeem_${Date.now()}`]: {
            code,
            amount: creditsToAdd,
            at: new Date().toISOString(),
          },
        }, { merge: true });
      }

      return { ok: true, creditsAdded: creditsToAdd, newBalance };
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[redeem] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}
