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
import { postText, postPhoto, postPhotoBuffer, postMultiPhotos, FBError } from './_lib/fb.js';

// 提高 body 上限，讓 admin 能直接上傳多張圖（base64 expand ~33%，5MB ≈ 3.7MB raw）
export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

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
    // FB 粉專管理動作 (admin-only, Phase 1; Phase 2 多用戶開放時拿掉 admin gate)
    if (typeof action === 'string' && action.startsWith('fb_')) {
      return await handleFbAction(req, res, decoded, action);
    }
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

// ════════════════════════════════════════════════════
// FB 粉專管理 (合進 adjust.js 是因為 hobby tier 12 functions 上限)
// 子 action: fb_pages / fb_post / fb_history / fb_disconnect / fb_setup_pages
// ════════════════════════════════════════════════════

const FB_MAX_POSTS_PER_REQ = 20;
const FB_HISTORY_DEFAULT_LIMIT = 50;
const FB_HISTORY_MAX_LIMIT = 200;
const FB_HISTORY_ALLOWED_STATUS = new Set(['posted', 'scheduled', 'failed']);

async function handleFbAction(req, res, decoded, action) {
  // Phase 1: admin gate. Phase 2 OAuth 開放後拿掉這 4 行
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!adminEmails.includes(decoded.email)) {
    return res.status(403).json({ error: '尚未開放', reason: 'notAdmin' });
  }

  if (action === 'fb_pages')         return handleFbPages(req, res, decoded);
  if (action === 'fb_post')          return handleFbPost(req, res, decoded);
  if (action === 'fb_history')       return handleFbHistory(req, res, decoded);
  if (action === 'fb_disconnect')    return handleFbDisconnect(req, res, decoded);
  if (action === 'fb_setup_pages')   return handleFbSetupPages(req, res, decoded);
  return res.status(400).json({ error: '無效的 fb action', reason: 'badFbAction' });
}

async function handleFbPages(req, res, decoded) {
  const db = getFirestore();
  const snap = await db.collection('fb_user_pages').doc(decoded.uid).get();
  if (!snap.exists) return res.status(200).json({ pages: [], connected: false });
  const data = snap.data();
  return res.status(200).json({
    pages: (data.pages || []).map(p => ({ name: p.name, id: p.id, added_at: p.added_at })),
    connected: true,
    connected_at: data.connected_at,
  });
}

async function handleFbSetupPages(req, res, decoded) {
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
}

async function handleFbPost(req, res, decoded) {
  const uid = decoded.uid;
  const posts = req.body?.posts;
  if (!Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: 'posts 必須是非空陣列', reason: 'badPosts' });
  }
  if (posts.length > FB_MAX_POSTS_PER_REQ) {
    return res.status(400).json({ error: `一次最多 ${FB_MAX_POSTS_PER_REQ} 篇`, reason: 'tooMany' });
  }

  const db = getFirestore();
  const userPagesSnap = await db.collection('fb_user_pages').doc(uid).get();
  if (!userPagesSnap.exists) {
    return res.status(400).json({ error: '尚未連結 FB 粉專', reason: 'noConnection' });
  }
  const userPages = userPagesSnap.data().pages || [];
  const pageMap = Object.fromEntries(userPages.map(p => [p.id, p]));

  const results = [];
  const MAX_PHOTOS_PER_POST = 10;
  for (const item of posts) {
    const page_id = String(item?.page_id || '');
    const message = String(item?.message || '');
    const image_url = item?.image_url ? String(item.image_url) : null;
    const scheduled_at = item?.scheduled_at ? parseInt(item.scheduled_at, 10) : null;
    const rawPhotos = Array.isArray(item?.photoBase64s) ? item.photoBase64s : [];

    const page = pageMap[page_id];
    if (!page) { results.push({ page_id, ok: false, error: '不在你的粉專列表' }); continue; }
    if (rawPhotos.length > MAX_PHOTOS_PER_POST) {
      results.push({ page_id, page_name: page.name, ok: false, error: `一篇最多 ${MAX_PHOTOS_PER_POST} 張圖` });
      continue;
    }
    // 把 base64 → Buffer (上傳用，不存 Firestore)
    let photoBufs = [];
    try {
      photoBufs = rawPhotos.map(p => {
        if (!p?.base64) throw new Error('photo base64 missing');
        return { buffer: Buffer.from(p.base64, 'base64'), mimeType: String(p.mimeType || 'image/jpeg') };
      });
    } catch (e) {
      results.push({ page_id, page_name: page.name, ok: false, error: '圖片解碼失敗：' + e.message });
      continue;
    }
    const photoCount = photoBufs.length;
    if (!message && !image_url && photoCount === 0) {
      results.push({ page_id, page_name: page.name, ok: false, error: 'message / image_url / 上傳圖片 至少要一個' });
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
      let fbResult;
      if (photoCount >= 2) {
        fbResult = await postMultiPhotos(page.id, page.token, photoBufs, message, scheduled_at);
      } else if (photoCount === 1) {
        fbResult = await postPhotoBuffer(page.id, page.token, photoBufs[0].buffer, photoBufs[0].mimeType, message, scheduled_at);
      } else if (image_url) {
        fbResult = await postPhoto(page.id, page.token, image_url, message, scheduled_at);
      } else {
        fbResult = await postText(page.id, page.token, message, scheduled_at);
      }
      const fbPostId = fbResult.post_id || fbResult.id;

      await db.collection('fb_posts').add({
        user_uid: uid,
        user_email: decoded.email,
        page_id: page.id,
        page_name: page.name,
        message,
        image_url,
        photo_count: photoCount,
        fb_post_id: fbPostId,
        status,
        posted_at: now,
        scheduled_at: scheduled_at ? new Date(scheduled_at * 1000).toISOString() : null,
      });
      results.push({ page_id: page.id, page_name: page.name, ok: true, fb_post_id: fbPostId, status, photo_count: photoCount });
    } catch (e) {
      const errMsg = e instanceof FBError ? e.message : (e.message || String(e));
      await db.collection('fb_posts').add({
        user_uid: uid,
        user_email: decoded.email,
        page_id: page.id,
        page_name: page.name,
        message,
        image_url,
        photo_count: photoCount,
        status: 'failed',
        error_msg: errMsg,
        posted_at: now,
      });
      results.push({ page_id: page.id, page_name: page.name, ok: false, error: errMsg });
    }
  }
  return res.status(200).json({ results });
}

async function handleFbHistory(req, res, decoded) {
  const limit = Math.min(parseInt(req.body?.limit || FB_HISTORY_DEFAULT_LIMIT, 10) || FB_HISTORY_DEFAULT_LIMIT, FB_HISTORY_MAX_LIMIT);
  const status = String(req.body?.status || '').trim();

  const db = getFirestore();
  let query = db.collection('fb_posts').where('user_uid', '==', decoded.uid);
  if (status && FB_HISTORY_ALLOWED_STATUS.has(status)) {
    query = query.where('status', '==', status);
  }
  query = query.orderBy('posted_at', 'desc').limit(limit);

  const snap = await query.get();
  const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return res.status(200).json({ posts, count: posts.length });
}

async function handleFbDisconnect(req, res, decoded) {
  const db = getFirestore();
  await db.collection('fb_user_pages').doc(decoded.uid).delete();
  return res.status(200).json({ ok: true });
}
