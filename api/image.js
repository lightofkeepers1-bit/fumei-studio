// api/image.js — Fumei Studio 生圖 API（KIE Nano Banana / Pro）
// KIE 是非同步 Task 系統：先建立任務拿 taskId，再輪詢等結果

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

// 建立任務
async function createTask(apiKey, model, input) {
  const r = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || data.error || `KIE 建立任務失敗 (${r.status})`);
  // 回傳格式：{ code: 200, data: { taskId: '...' } }
  const taskId = data.data?.taskId || data.taskId;
  if (!taskId) throw new Error('KIE 沒有回傳 taskId：' + JSON.stringify(data).slice(0, 200));
  return taskId;
}

// 輪詢任務狀態（最多等 120 秒）
async function pollTask(apiKey, taskId, maxWaitMs = 120000) {
  const start = Date.now();
  const interval = 3000; // 每 3 秒查一次

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, interval));

    const r = await fetch(`${KIE_BASE}/api/v1/jobs/queryTask?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await r.json();
    const task = data.data || data;
    const status = task.status || task.state;

    if (status === 'success' || status === 'completed') {
      // 找圖片 URL
      const output = task.output || task.result || {};
      let images = [];
      if (Array.isArray(output.images))       images = output.images.map(u => ({ url: typeof u === 'string' ? u : u.url }));
      else if (Array.isArray(output.imageUrl)) images = output.imageUrl.map(u => ({ url: u }));
      else if (output.imageUrl)                images = [{ url: output.imageUrl }];
      else if (output.url)                     images = [{ url: output.url }];
      else if (Array.isArray(task.images))     images = task.images.map(u => ({ url: typeof u === 'string' ? u : u.url }));
      if (!images.length) throw new Error('生圖完成但找不到圖片網址，請稍後再試');
      return images;
    }

    if (status === 'fail' || status === 'failed' || status === 'error') {
      throw new Error(task.errorMessage || task.error || '生圖失敗，請稍後再試');
    }

    // status === 'pending' | 'running' → 繼續等
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
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定，請聯絡管理員' });

  const { quality = 'std', prompt, ratio = '9:16', refs = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: '請提供 prompt' });

  const isPro  = quality === 'pro';
  const model  = isPro ? 'nano-banana-pro' : 'nano-banana';
  const input  = isPro
    ? {
        prompt,
        aspect_ratio:  ratio,
        resolution:    '1K',
        output_format: 'png',
        ...(refs.length > 0 ? { image_input: refs.map(r => `data:${r.mimeType};base64,${r.base64}`) } : {}),
      }
    : {
        prompt,
        image_size:    ratio,
        output_format: 'png',
        ...(refs.length > 0 ? { image_urls: refs.map(r => `data:${r.mimeType};base64,${r.base64}`) } : {}),
      };

  try {
    // Step 1：建立任務
    const taskId = await createTask(KIE_API_KEY, model, input);

    // Step 2：輪詢等結果
    const images = await pollTask(KIE_API_KEY, taskId);

    // 記錄使用次數
    fsIncrement(`users/${uid}`, 'usage_image').catch(() => {});

    return res.status(200).json({ images });

  } catch(e) {
    console.error('[image] error:', e.message);
    return res.status(500).json({ error: e.message || '伺服器錯誤，請稍後再試' });
  }
}
