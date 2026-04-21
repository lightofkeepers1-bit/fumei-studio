// api/adjust.js — 統一的點數調整端點（refund + referral）
// 所有會「增加 fumei_credits」的操作都走這裡，避免前端直寫被 firestore.rules 擋掉
//
// POST /api/adjust + Authorization: Bearer <idToken>
// Body:
//   { action: 'refund', amount: 1-50, reason: <allowed string> }
//   { action: 'referral', referrerShortId: <6+ chars> }
//
// 回傳:
//   refund   → { ok, creditsAdded, newBalance }
//   referral → { ok, creditsAdded, newBalance, referrerCount }
//   失敗     → { ok: false, error, reason }

import { getFirestore, verifyIdToken, getIdTokenFromReq } from './_lib/admin.js';

const REFUND_REASONS = new Set([
  'image_fail',    // 生圖失敗
  'script_fail',   // 腳本生成失敗
  'scan_fail',     // 話題掃描失敗
  'inspo_fail',    // 三AI發想失敗
  'stale_refund',  // 批次退 stale entries
]);
const REFUND_MAX = 500;  // 單次退點上限（批次 stale 退最壞 = 50 entries × 8 pts(img pro) = 400，留 buffer）

// 與前端 index.html ~line 890 的常數對齊
const REFERRAL_REWARD_REFERRER = 50;
const REFERRAL_REWARD_REFEREE  = 20;
const REFERRAL_MAX_COUNT       = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── 1. 驗證身份 ─────────────────────────────
    const idToken = getIdTokenFromReq(req);
    if (!idToken) return res.status(401).json({ error: '未登入', reason: 'noAuth' });
    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (e) {
      if (e.name === 'AdminMisconfiguredError') {
        console.error('[adjust] admin misconfigured:', e.message);
        return res.status(500).json({ error: '伺服器設定錯誤', reason: 'serverMisconfigured' });
      }
      return res.status(401).json({ error: '身份驗證失敗', reason: 'invalidToken' });
    }
    const uid = decoded.uid;

    // ── 2. 分派 action ──────────────────────────
    const action = req.body?.action;
    if (action === 'refund')   return await handleRefund(req, res, uid);
    if (action === 'referral') return await handleReferral(req, res, uid);
    return res.status(400).json({ error: '無效的 action', reason: 'badAction' });

  } catch (err) {
    console.error('[adjust] error:', err);
    return res.status(500).json({ error: err.message || '伺服器錯誤', reason: 'serverError' });
  }
}

// ── Refund ──────────────────────────────────────
async function handleRefund(req, res, uid) {
  const amount = parseInt(req.body?.amount || 0, 10);
  const reason = String(req.body?.reason || '').trim();

  if (!amount || amount <= 0 || amount > REFUND_MAX) {
    return res.status(400).json({ error: `退點金額必須 1-${REFUND_MAX}`, reason: 'badAmount' });
  }
  if (!REFUND_REASONS.has(reason)) {
    return res.status(400).json({ error: '無效的退點原因', reason: 'badReason' });
  }

  const db = getFirestore();
  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    const data = userSnap.exists ? userSnap.data() : {};
    const current = parseInt(data.fumei_credits || 0, 10);
    const newBalance = Math.max(0, current) + amount;

    const auditKey = `fumei_credits_added_${Date.now()}`;
    const auditData = { amount, source: reason, at: new Date().toISOString() };
    if (userSnap.exists) {
      tx.update(userRef, { fumei_credits: newBalance, [auditKey]: auditData });
    } else {
      tx.set(userRef, { fumei_credits: newBalance, [auditKey]: auditData }, { merge: true });
    }
    return { ok: true, creditsAdded: amount, newBalance };
  });

  return res.status(200).json(result);
}

// ── Referral ────────────────────────────────────
async function handleReferral(req, res, uid) {
  const refShortId = String(req.body?.referrerShortId || '').trim();
  if (!refShortId || refShortId.length < 6) {
    return res.status(400).json({ error: '無效的邀請 ID', reason: 'badShortId' });
  }
  if (uid.startsWith(refShortId)) {
    return res.status(400).json({ error: '不能邀請自己', reason: 'selfReferral' });
  }

  const db = getFirestore();

  // 先做 pre-check（不在 tx 裡）減少 tx 負擔
  const referralRef = db.collection('referrals').doc(uid);
  const existingReferral = await referralRef.get();
  if (existingReferral.exists) {
    return res.status(400).json({ error: '已使用過邀請', reason: 'alreadyRewarded' });
  }

  // 找 referrer：掃 users 找 id 以 refShortId 開頭的文件
  // TODO(scale): 未來使用者多了要改用 __name__ 區間查詢
  const usersSnap = await db.collection('users').get();
  const referrerDoc = usersSnap.docs.find(d => d.id.startsWith(refShortId) && d.id !== uid);
  if (!referrerDoc) {
    return res.status(404).json({ error: '找不到對應的邀請者', reason: 'referrerNotFound' });
  }
  const referrerUid = referrerDoc.id;

  // ── 原子 tx：三個文件一起寫 ──
  const result = await db.runTransaction(async (tx) => {
    // 在 tx 內再確認一次，防 race
    const rSnap = await tx.get(referralRef);
    if (rSnap.exists) {
      return { ok: false, reason: 'alreadyRewarded', error: '已使用過邀請' };
    }

    const referrerRef = db.collection('users').doc(referrerUid);
    const refereeRef  = db.collection('users').doc(uid);
    const rr = await tx.get(referrerRef);
    const re = await tx.get(refereeRef);
    const rrData = rr.exists ? rr.data() : {};
    const reData = re.exists ? re.data() : {};

    const rrCount = parseInt(rrData.fumei_referral_count || 0, 10);
    if (rrCount >= REFERRAL_MAX_COUNT) {
      return { ok: false, reason: 'referrerFull', error: '邀請人已達上限' };
    }

    const rrNewCredits = parseInt(rrData.fumei_credits || 0, 10) + REFERRAL_REWARD_REFERRER;
    const reNewCredits = parseInt(reData.fumei_credits || 0, 10) + REFERRAL_REWARD_REFEREE;
    const now = Date.now();

    tx.set(referralRef, {
      referrer_uid: referrerUid,
      rewarded: true,
      created_at: new Date().toISOString(),
    });
    tx.update(referrerRef, {
      fumei_credits: rrNewCredits,
      fumei_referral_count: rrCount + 1,
      [`fumei_credits_added_${now}`]: {
        amount: REFERRAL_REWARD_REFERRER,
        source: 'referral',
        at: new Date().toISOString(),
      },
    });
    if (re.exists) {
      tx.update(refereeRef, {
        fumei_credits: reNewCredits,
        [`fumei_credits_added_${now + 1}`]: {
          amount: REFERRAL_REWARD_REFEREE,
          source: 'referral_bonus',
          at: new Date().toISOString(),
        },
      });
    } else {
      tx.set(refereeRef, {
        fumei_credits: reNewCredits,
        [`fumei_credits_added_${now + 1}`]: {
          amount: REFERRAL_REWARD_REFEREE,
          source: 'referral_bonus',
          at: new Date().toISOString(),
        },
      }, { merge: true });
    }

    return {
      ok: true,
      creditsAdded: REFERRAL_REWARD_REFEREE,
      newBalance: reNewCredits,
      referrerCount: rrCount + 1,
    };
  });

  if (!result.ok) return res.status(400).json(result);
  return res.status(200).json(result);
}
