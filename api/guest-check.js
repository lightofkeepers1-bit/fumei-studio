// api/guest-check.js
// GET  → 查詢剩餘次數（不扣）：?type=scan 或 ?type=script
// POST → 扣一次，回傳 session token：body { type: 'scan' | 'script' }
// 話題掃描：每日 5 次（guest_usage_scan）
// 產腳本：每日 10 次（guest_usage_script）

const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const LIMITS = { scan: 5, script: 10 };
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function fsGet(docPath) {
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
  if (r.status === 404) return null;
  const d = await r.json();
  return d.fields || null;
}

async function fsPatch(docPath, fields) {
  const fieldMask = Object.keys(fields).join(',');
  await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${fieldMask}&key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function getUsed(safeKey, type) {
  const today = new Date().toISOString().slice(0, 10);
  const data = await fsGet(`guest_usage_${type}/${safeKey}`);
  const docDate = data?.date?.stringValue || '';
  return docDate === today ? parseInt(data?.count?.integerValue || '0', 10) : 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fingerprint');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const fingerprint = req.headers['x-fingerprint'] || '';
  const safeKey = fingerprint.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  // GET：查詢剩餘
  if (req.method === 'GET') {
    const type = req.query?.type === 'script' ? 'script' : 'scan';
    const limit = LIMITS[type];
    if (!safeKey) return res.status(200).json({ remaining: limit, type });
    const used = await getUsed(safeKey, type);
    return res.status(200).json({ remaining: Math.max(0, limit - used), type });
  }

  if (req.method !== 'POST') return res.status(405).end();
  if (!safeKey) return res.status(401).json({ error: '請先啟用訪客模式', needLogin: true });

  const type = req.body?.type === 'script' ? 'script' : 'scan';
  const limit = LIMITS[type];
  const today = new Date().toISOString().slice(0, 10);
  const used = await getUsed(safeKey, type);

  if (used >= limit) {
    const label = type === 'script' ? '產腳本' : '話題掃描';
    return res.status(429).json({
      error: `🌟 今日${label}體驗次數已用完（${limit}次）！登入後可無限使用`,
      needLogin: true,
      remaining: 0,
      type,
    });
  }

  // 扣次數
  const newCount = used + 1;
  await fsPatch(`guest_usage_${type}/${safeKey}`, {
    date:  { stringValue: today },
    count: { integerValue: String(newCount) },
  });

  // 產生 session token
  const token = `${safeKey.slice(0, 12)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await fsPatch(`guest_tokens/${token}`, {
    fp:      { stringValue: safeKey },
    expires: { integerValue: String(Date.now() + 5 * 60 * 1000) },
  });

  return res.status(200).json({ remaining: limit - newCount, token, type });
}
