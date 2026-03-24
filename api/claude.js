// ── 設定 ──────────────────────────────────────────
const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const GUEST_DAILY_LIMIT = 5;

// ── Firestore REST 工具 ────────────────────────────
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function fsGet(docPath) {
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
  if (r.status === 404) return null;
  const d = await r.json();
  return d.fields || null;
}

async function fsPatch(docPath, fields) {
  const body = { fields };
  const fieldMask = Object.keys(fields).join(',');
  await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${fieldMask}&key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── 訪客限流 ───────────────────────────────────────
async function checkGuestLimit(fingerprint, ip) {
  const today = new Date().toISOString().slice(0, 10);
  const safeKey = (fingerprint || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const docPath = `guest_usage/${safeKey}`;

  const data = await fsGet(docPath);

  if (data) {
    const docDate  = data.date?.stringValue || '';
    const docCount = parseInt(data.count?.integerValue || '0', 10);
    if (docDate === today && docCount >= GUEST_DAILY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }
    const newCount = docDate === today ? docCount + 1 : 1;
    await fsPatch(docPath, {
      date:  { stringValue: today },
      count: { integerValue: String(newCount) },
      ip:    { stringValue: ip },
    });
    return { allowed: true, remaining: GUEST_DAILY_LIMIT - newCount };
  } else {
    await fsPatch(docPath, {
      date:  { stringValue: today },
      count: { integerValue: '1' },
      ip:    { stringValue: ip },
    });
    return { allowed: true, remaining: GUEST_DAILY_LIMIT - 1 };
  }
}


// ── 使用次數累加 ────────────────────────────────────
async function fsIncrement(docPath, field) {
  try {
    const data = await fsGet(docPath);
    const current = parseInt(data?.[field]?.integerValue || '0', 10);
    await fsPatch(docPath, { [field]: { integerValue: String(current + 1) } });
  } catch(e) { /* 不影響主流程 */ }
}

// ── IP 速率限制 ─────────────────────────────────────
const ipCache = new Map();
function checkIpRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxPerWindow = 20;
  const entry = ipCache.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { ipCache.set(ip, { count: 1, start: now }); return true; }
  if (entry.count >= maxPerWindow) return false;
  entry.count++;
  ipCache.set(ip, entry);
  return true;
}

// ── 訪客封鎖功能 ────────────────────────────────────
const GUEST_BLOCKED_FEATURES = ['reply'];

// ── 驗證 session token ──────────────────────────────
async function validateToken(token) {
  if (!token) return false;
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const data = await fsGet(`guest_tokens/${safeToken}`);
  if (!data) return false;
  const expires = parseInt(data.expires?.integerValue || '0', 10);
  return Date.now() < expires;
}

// ── Main Handler ────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid, x-fingerprint, x-guest-feature, x-guest-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET：查詢訪客剩餘次數
  if (req.method === 'GET') {
    const fingerprint = req.headers['x-fingerprint'] || '';
    if (!fingerprint) return res.status(200).json({ remaining: GUEST_DAILY_LIMIT });
    const today = new Date().toISOString().slice(0, 10);
    const safeKey = fingerprint.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const data = await fsGet(`guest_usage/${safeKey}`);
    const docDate = data?.date?.stringValue || '';
    const used = docDate === today ? parseInt(data?.count?.integerValue || '0', 10) : 0;
    return res.status(200).json({ remaining: Math.max(0, GUEST_DAILY_LIMIT - used) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid         = req.headers['x-firebase-uid'];
  const fingerprint = req.headers['x-fingerprint'] || '';
  const feature     = req.headers['x-guest-feature'] || '';
  const guestToken  = req.headers['x-guest-token'] || '';
  const ip          = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // 登入用戶有點數系統管控，不做 IP 限制；只對訪客做 IP 限制
  if (!uid && !checkIpRate(ip)) return res.status(429).json({ error: '⚠️ 請求過於頻繁，請稍後再試' });

  if (!uid) {
    if (GUEST_BLOCKED_FEATURES.includes(feature)) {
      return res.status(403).json({ error: '🔒 此功能需要登入才能使用', needLogin: true });
    }
    if (!fingerprint) {
      return res.status(401).json({ error: '請先登入或啟用訪客模式', needLogin: true });
    }

    // 有 session token → 同批操作，不重複扣次數
    const tokenValid = guestToken ? await validateToken(guestToken) : false;
    if (!tokenValid) {
      // 沒有 token 或 token 無效 → 扣次數
      const { allowed, remaining } = await checkGuestLimit(fingerprint, ip);
      if (!allowed) {
        return res.status(429).json({ error: '🌟 今日訪客體驗次數已用完！登入後可無限使用', needLogin: true, remaining: 0 });
      }
      res.setHeader('x-guest-remaining', String(remaining));
    }
  }

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Server config error' });

  try {
    const body = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        ...(body.tools?.some(t => t.type === 'web_search_20250305')
          ? { 'anthropic-beta': 'web-search-2025-03-05' }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    // 記錄登入用戶使用次數
    if (uid && response.ok) {
      fsIncrement(`users/${uid}`, 'usage_claude').catch(() => {});
    }
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
