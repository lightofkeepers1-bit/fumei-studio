// api/image.js — Fumei Studio 生圖 API（KIE Nano Banana / Pro）
const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

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
  if (entry.count >= 5) return false;
  entry.count++; ipCache.set(ip, entry); return true;
}

const KIE_BASE = 'https://api.kie.ai';

async function createTask(apiKey, model, input) {
  const r = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.msg || data.message || data.error || `KIE 建立任務失敗 (${r.status})`);
  const taskId = data.data?.taskId || data.taskId;
  if (!taskId) throw new Error('KIE 沒有回傳 taskId：' + JSON.stringify(data).slice(0, 300));
  return taskId;
}

// 從任務回應中抽出圖片 URL
function extractImages(task) {
  // 嘗試各種可能的結構
  const candidates = [
    task?.output?.images,
    task?.result?.images,
    task?.images,
    task?.output?.imageUrl,
    task?.result?.imageUrl,
    task?.imageUrl,
    task?.output?.url,
    task?.result?.url,
    task?.url,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c) && c.length > 0) {
      return c.map(u => ({ url: typeof u === 'string' ? u : (u.url || String(u)) }));
    }
    if (typeof c === 'string' && c.startsWith('http')) {
      return [{ url: c }];
    }
  }
  return [];
}

async function pollTask(apiKey, taskId, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 4000));

    const r = await fetch(`${KIE_BASE}/api/v1/jobs/queryTask?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const raw = await r.json();
    console.log('[image] queryTask raw:', JSON.stringify(raw).slice(0, 500));

    // KIE 回傳結構：{ code, data: { status, output, ... } }
    const task = raw?.data || raw;
    const statusRaw = task?.status ?? task?.state ?? '';
    const status = String(statusRaw).toLowerCase();

    if (status === 'success' || status === 'completed' || status === 'finish' || statusRaw === 1 || statusRaw === '1') {
      const images = extractImages(task);
      if (!images.length) throw new Error('生圖完成但找不到圖片網址，請稍後再試');
      return images;
    }

    if (status === 'fail' || status === 'failed' || status === 'error' || statusRaw === -1 || statusRaw === 2) {
      throw new Error(task?.errorMessage || task?.error || task?.msg || '生圖失敗，請稍後再試');
    }
    // pending / running / 0 → 繼續等
  }
  throw new Error('生圖逾時（超過 120 秒），請稍後再試');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = req.headers['x-firebase-uid'];
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  if (!uid) return res.status(401).json({ error: '請先登入才能使用生圖功能', needLogin: true });
  if (!checkIpRate(ip)) return res.status(429).json({ error: '⚠️ 請求過於頻繁，請稍後再試' });

  const KIE_API_KEY = process.env.KIE_API_KEY;
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定' });

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
    const taskId = await createTask(KIE_API_KEY, model, input);
    console.log('[image] taskId:', taskId);
    const images = await pollTask(KIE_API_KEY, taskId);
    fsIncrement(`users/${uid}`, 'usage_image').catch(() => {});
    return res.status(200).json({ images });
  } catch(e) {
    console.error('[image] error:', e.message);
    return res.status(500).json({ error: e.message || '伺服器錯誤' });
  }
}
