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
  if (!r.ok) return null;
  const d = await r.json();
  // Firestore REST 回傳 { name, fields, createTime, updateTime }
  // fields 可能不存在（空文件）
  if (!d.fields) return null;
  return d.fields;
}

async function fsSet(docPath, fields) {
  // 用 PATCH 不帶 updateMask = 完整覆寫（等同 set）
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return r.ok;
}

async function fsUpdateCredits(docPath, credits) {
  // 只更新 credits 和 updated_at 兩個欄位
  // Firestore updateMask 多個欄位要用 &updateMask.fieldPaths=x&updateMask.fieldPaths=y
  const url = `${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`
    + `&updateMask.fieldPaths=credits`
    + `&updateMask.fieldPaths=updated_at`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        credits:    { integerValue: String(credits) },
        updated_at: { stringValue: new Date().toISOString() },
      }
    }),
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fingerprint');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const fingerprint = req.headers['x-fingerprint'] || '';
  const safeKey = fingerprint.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!safeKey) return res.status(400).json({ error: '無效的裝置識別碼' });

  const docPath = `guest_credits/${safeKey}`;

  try {
    // ── GET：查詢/初始化點數
    if (req.method === 'GET') {
      const data = await fsGet(docPath);
      if (data === null) {
        // 新訪客：初始化 20 點
        await fsSet(docPath, {
          credits:    { integerValue: String(GUEST_INIT_CREDITS) },
          created_at: { stringValue: new Date().toISOString() },
          updated_at: { stringValue: new Date().toISOString() },
        });
        return res.status(200).json({ credits: GUEST_INIT_CREDITS, isNew: true });
      }
      // 舊訪客：回傳現有點數
      const credits = parseInt(data.credits?.integerValue ?? '0', 10);
      return res.status(200).json({ credits });
    }

    // ── POST：扣點數
    if (req.method === 'POST') {
      const cost = parseInt(req.body?.cost ?? 1, 10);
      const data = await fsGet(docPath);

      // 文件不存在：初始化再扣
      if (data === null) {
        const newCredits = GUEST_INIT_CREDITS - cost;
        await fsSet(docPath, {
          credits:    { integerValue: String(newCredits) },
          created_at: { stringValue: new Date().toISOString() },
          updated_at: { stringValue: new Date().toISOString() },
        });
        return res.status(200).json({ credits: newCredits });
      }

      const current = parseInt(data.credits?.integerValue ?? '0', 10);
      if (current < cost) {
        return res.status(403).json({
          error: '⚡ 訪客點數已用完！登入後可獲得完整點數。',
          needLogin: true,
          credits: 0,
        });
      }

      const newCredits = current - cost;
      await fsUpdateCredits(docPath, newCredits);
      const token = `${safeKey.slice(0, 12)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return res.status(200).json({ credits: newCredits, token });
    }

    return res.status(405).end();

  } catch(err) {
    console.error('[guest-check]', err);
    return res.status(500).json({ error: err.message });
  }
}
