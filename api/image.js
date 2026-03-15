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
    const fieldMask = field;
    await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${fieldMask}&key=${FIREBASE_API_KEY}`, {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = req.headers['x-firebase-uid'];
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // 生圖只限登入用戶
  if (!uid) return res.status(401).json({ error: '請先登入才能使用生圖功能', needLogin: true });

  if (!checkIpRate(ip)) return res.status(429).json({ error: '⚠️ 請求過於頻繁，請稍後再試' });

  const KIE_API_KEY = process.env.KIE_API_KEY;
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定' });

  const { quality = 'std', prompt, ratio = '9:16', refs = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: '請提供 prompt' });

  const isPro    = quality === 'pro';
  const KIE_BASE = 'https://api.kie.ai';

  try {
    let endpoint, requestBody;

    if (isPro) {
      // Nano Banana Pro
      endpoint = `${KIE_BASE}/api/v1/images/nano-banana-pro`;
      requestBody = {
        prompt,
        aspect_ratio:  ratio,
        resolution:    '1K',
        output_format: 'png',
        ...(refs.length > 0 ? { image_input: refs.map(r => `data:${r.mimeType};base64,${r.base64}`) } : {}),
      };
    } else {
      // Nano Banana 標準版
      if (refs.length > 0) {
        endpoint = `${KIE_BASE}/api/v1/images/nano-banana-edit`;
        requestBody = {
          prompt,
          image_urls:    refs.map(r => `data:${r.mimeType};base64,${r.base64}`),
          image_size:    ratio,
          output_format: 'png',
        };
      } else {
        endpoint = `${KIE_BASE}/api/v1/images/nano-banana`;
        requestBody = {
          prompt,
          image_size:    ratio,
          output_format: 'png',
        };
      }
    }

    const kieRes = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${KIE_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const kieData = await kieRes.json();

    if (!kieRes.ok) {
      console.error('[image] KIE error:', JSON.stringify(kieData));
      return res.status(502).json({ error: kieData.message || kieData.error || 'KIE API 錯誤，請稍後再試' });
    }

    // 解析 KIE 回傳圖片
    let images = [];
    if (Array.isArray(kieData.data))        images = kieData.data.map(d => ({ url: d.url || d }));
    else if (Array.isArray(kieData.images)) images = kieData.images.map(d => ({ url: d.url || d }));
    else if (kieData.url)                   images = [{ url: kieData.url }];
    else if (typeof kieData === 'string')   images = [{ url: kieData }];

    if (!images.length) {
      console.error('[image] no images:', JSON.stringify(kieData).slice(0, 300));
      return res.status(502).json({ error: '生圖完成但沒有收到圖片，請稍後再試' });
    }

    // 記錄使用次數
    if (uid) fsIncrement(`users/${uid}`, 'usage_image').catch(() => {});

    return res.status(200).json({ images });

  } catch(e) {
    console.error('[image] exception:', e);
    return res.status(500).json({ error: e.message || '伺服器錯誤' });
  }
}
