// api/guest-check.js
// GET  ?type=credits → 查詢訪客剩餘點數（新訪客自動初始化 20 點）
// POST ?type=deduct  → 扣點數 body: { cost: 1 }

const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const GUEST_INIT_CREDITS = 20;
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

async function fsCreate(docPath, fields) {
  await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fingerprint');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const fingerprint = req.headers['x-fingerprint'] || '';
  const safeKey = fingerprint.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!safeKey) return res.status(400).json({ error: '無效的裝置識別碼' });

  const docPath = `guest_credits/${safeKey}`;

  // GET：查詢/初始化點數
  if (req.method === 'GET') {
    let data = await fsGet(docPath);
    if (!data) {
      await fsCreate(docPath, {
        credits:    { integerValue: String(GUEST_INIT_CREDITS) },
        created_at: { stringValue: new Date().toISOString() },
        updated_at: { stringValue: new Date().toISOString() },
      });
      return res.status(200).json({ credits: GUEST_INIT_CREDITS, isNew: true });
    }
    const credits = parseInt(data.credits?.integerValue ?? GUEST_INIT_CREDITS, 10);
    return res.status(200).json({ credits });
  }

  // POST：扣點數
  if (req.method === 'POST') {
    const cost = parseInt(req.body?.cost ?? 1, 10);
    let data = await fsGet(docPath);
    let current = GUEST_INIT_CREDITS;

    if (!data) {
      await fsCreate(docPath, {
        credits:    { integerValue: String(GUEST_INIT_CREDITS) },
        created_at: { stringValue: new Date().toISOString() },
        updated_at: { stringValue: new Date().toISOString() },
      });
    } else {
      current = parseInt(data.credits?.integerValue ?? 0, 10);
    }

    if (current < cost) {
      return res.status(403).json({
        error: '⚡ 訪客點數已用完！登入後可獲得完整點數。',
        needLogin: true,
        credits: 0,
      });
    }

    const newCredits = current - cost;
    await fsPatch(docPath, {
      credits:    { integerValue: String(newCredits) },
      updated_at: { stringValue: new Date().toISOString() },
    });

    const token = `${safeKey.slice(0, 12)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return res.status(200).json({ credits: newCredits, token });
  }

  return res.status(405).end();
}
