// api/image.js — Fumei Studio 生圖 API（KIE）
// POST：建立任務 → 回傳 taskId
// GET：查詢任務狀態 → 回傳 status + images

const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const KIE_BASE = 'https://api.kie.ai';

async function fsGet(docPath) {
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
  if (r.status === 404) return null;
  const d = await r.json();
  return d.fields || null;
}

async function fsIncrement(docPath, field) {
  try {
    const data = await fsGet(docPath);
    const current = parseInt(data?.[field]?.integerValue || '0', 10);
    await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${field}&key=${FIREBASE_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [field]: { integerValue: String(current + 1) } } }),
    });
  } catch(e) {}
}

const ipCache = new Map();
function checkIpRate(ip) {
  const now = Date.now();
  const entry = ipCache.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60000) { ipCache.set(ip, { count: 1, start: now }); return true; }
  if (entry.count >= 10) return false;
  entry.count++; ipCache.set(ip, entry); return true;
}

function extractImages(task) {
  const candidates = [
    task?.output?.images, task?.result?.images, task?.images,
    task?.output?.imageUrl, task?.result?.imageUrl, task?.imageUrl,
    task?.output?.url, task?.result?.url, task?.url,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c) && c.length > 0)
      return c.map(u => ({ url: typeof u === 'string' ? u : (u.url || String(u)) }));
    if (typeof c === 'string' && c.startsWith('http'))
      return [{ url: c }];
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const uid = req.headers['x-firebase-uid'];
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const KIE_API_KEY = process.env.KIE_API_KEY;
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定' });
  if (!checkIpRate(ip)) return res.status(429).json({ error: '⚠️ 請求過於頻繁' });

  // ── GET：查詢任務狀態（前端輪詢用）──────────────────
  if (req.method === 'GET') {
    const taskId = req.query.taskId;
    if (!taskId) return res.status(400).json({ error: '請提供 taskId' });

    const r = await fetch(`${KIE_BASE}/api/v1/jobs/queryTask?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    const raw = await r.json();
    const task = raw?.data || raw;
    const statusRaw = task?.status ?? task?.state ?? '';
    const status = String(statusRaw).toLowerCase();

    if (status === 'success' || status === 'completed' || status === 'finish' || statusRaw === 1 || statusRaw === '1') {
      const images = extractImages(task);
      if (uid) fsIncrement(`users/${uid}`, 'usage_image').catch(() => {});
      return res.status(200).json({ status: 'success', images });
    }
    if (status === 'fail' || status === 'failed' || status === 'error' || statusRaw === -1) {
      return res.status(200).json({ status: 'failed', error: task?.errorMessage || task?.msg || '生圖失敗' });
    }
    // 還在跑
    return res.status(200).json({ status: 'pending' });
  }

  // ── POST：建立任務 ───────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!uid) return res.status(401).json({ error: '請先登入才能使用生圖功能', needLogin: true });

  const { quality = 'std', prompt, ratio = '9:16', refs = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: '請提供 prompt' });

  const model = quality === 'pro' ? 'nano-banana-pro' : 'nano-banana-2';
  const input = {
    prompt,
    aspect_ratio:  ratio,
    resolution:    '1K',
    output_format: 'png',
    image_input:   refs.length > 0 ? refs.map(r => `data:${r.mimeType};base64,${r.base64}`) : [],
  };

  try {
    const r = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIE_API_KEY}` },
      body: JSON.stringify({ model, input }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.msg || data.message || data.error || `KIE 建立任務失敗 (${r.status})`);
    const taskId = data.data?.taskId || data.taskId;
    if (!taskId) throw new Error('KIE 沒有回傳 taskId：' + JSON.stringify(data).slice(0, 200));
    return res.status(200).json({ taskId });
  } catch(e) {
    console.error('[image] createTask error:', e.message);
    return res.status(500).json({ error: e.message || '建立任務失敗' });
  }
}
