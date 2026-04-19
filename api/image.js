// api/image.js — Fumei Studio 生圖 API（KIE）
const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const KIE_BASE = 'https://api.kie.ai';

async function fsIncrement(docPath, field) {
  try {
    const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
    if (r.status === 404) return;
    const d = await r.json();
    const current = parseInt(d.fields?.[field]?.integerValue || '0', 10);
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const uid = req.headers['x-firebase-uid'];
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const KIE_API_KEY = process.env.KIE_API_KEY;

  // ── 圖片 Proxy（解決 CORS，接受任何 https 圖片網址）──
  if (req.method === 'GET' && req.query.proxy) {
    const imgUrl = decodeURIComponent(req.query.proxy);
    // 基本安全：只允許 https
    if (!imgUrl.startsWith('https://')) {
      return res.status(403).json({ error: '只允許 https 圖片' });
    }
    try {
      const imgRes = await fetch(imgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiStudio/1.0)' }
      });
      if (!imgRes.ok) {
        return res.status(200).json({ proxyError: `圖片伺服器回應 ${imgRes.status}`, url: imgUrl });
      }
      const contentType = imgRes.headers.get('content-type') || 'image/png';
      // 確認是圖片類型
      if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet')) {
        return res.status(200).json({ proxyError: '非圖片格式', contentType, url: imgUrl });
      }
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Proxy-Url', imgUrl.slice(0, 80));
      return res.status(200).send(buffer);
    } catch(e) {
      console.error('[proxy] error:', e.message, imgUrl.slice(0, 80));
      return res.status(500).json({ proxyError: e.message, url: imgUrl.slice(0, 80) });
    }
  }

  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定' });
  if (!checkIpRate(ip)) return res.status(429).json({ error: '⚠️ 請求過於頻繁' });

  // ── GET：查詢任務狀態 ──────────────────────────────
  if (req.method === 'GET') {
    const taskId = req.query.taskId;
    if (!taskId) return res.status(400).json({ error: '請提供 taskId' });

    try {
      const r = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
      });
      const raw = await r.json();
      const task = raw?.data || {};
      const state = String(task?.state || '').toLowerCase();

      if (state === 'success') {
        let images = [];
        try {
          const result = typeof task.resultJson === 'string'
            ? JSON.parse(task.resultJson)
            : task.resultJson;
          const urls = result?.resultUrls || result?.images || result?.imageUrls || [];
          images = Array.isArray(urls)
            ? urls.map(u => {
                const rawUrl = typeof u === 'string' ? u : u.url;
                const proxyUrl = `/api/image?proxy=${encodeURIComponent(rawUrl)}`;
                return { url: proxyUrl, originalUrl: rawUrl };
              })
            : [];
        } catch(e) {
          console.error('[image] parse resultJson error:', e.message);
        }
        if (images.length === 0) {
          return res.status(200).json({ status: 'failed', error: '生圖完成但找不到圖片網址' });
        }
        if (uid) fsIncrement(`users/${uid}`, 'usage_image').catch(() => {});
        return res.status(200).json({ status: 'success', images });
      }

      if (state === 'fail' || state === 'failed' || state === 'error') {
        return res.status(200).json({
          status: 'failed',
          error: task?.failMsg || task?.errorMessage || '生圖失敗，請稍後再試',
        });
      }

      return res.status(200).json({ status: 'pending', state });

    } catch(e) {
      console.error('[image] recordInfo error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST：建立任務 ────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!uid) return res.status(401).json({ error: '請先登入才能使用生圖功能', needLogin: true });

  const { quality = 'std', prompt, ratio = '9:16', refs = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: '請提供 prompt' });

  const model = quality === 'pro' ? 'nano-banana-pro' : 'nano-banana-2';

  const KIE_UPLOAD_BASE = 'https://kieai.redpandaai.co';
  let imageUrls = [];
  if (refs.length > 0) {
    try {
      imageUrls = await Promise.all(refs.map(async (r, i) => {
        const uploadRes = await fetch(`${KIE_UPLOAD_BASE}/api/file-base64-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIE_API_KEY}` },
          body: JSON.stringify({
            base64Data: `data:${r.mimeType};base64,${r.base64}`,
            uploadPath: 'fumei/refs',
            fileName: `ref-${Date.now()}-${i}.jpg`,
          }),
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.data?.downloadUrl) {
          throw new Error(`參考圖上傳失敗：${uploadData.msg || uploadRes.status}`);
        }
        return uploadData.data.downloadUrl;
      }));
    } catch(e) {
      console.error('[image] upload refs error:', e.message);
      return res.status(500).json({ error: e.message || '參考圖上傳失敗' });
    }
  }

  const input = {
    prompt,
    aspect_ratio: ratio,
    resolution:   '1K',
    output_format: 'png',
    ...(imageUrls.length > 0 && { image_input: imageUrls }),
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
