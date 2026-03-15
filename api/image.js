// api/image.js — Fumei Studio 生圖 API（KIE Nano Banana / Pro）
// 部署到 Vercel 時放在 /api/image.js

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { credential } from 'firebase-admin';

// Firebase Admin 初始化（與其他 API 共用方式）
function getAdminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 驗證登入
  const uid = req.headers['x-firebase-uid'];
  if (!uid) return res.status(401).json({ error: '請先登入才能使用生圖功能' });

  const { quality = 'std', prompt, ratio = '9:16', refs = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: '請提供 prompt' });

  const KIE_API_KEY = process.env.KIE_API_KEY;
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE API Key 未設定' });

  // 選模型
  const isPro = quality === 'pro';
  const model = isPro ? 'google/nano-banana-pro' : 'google/nano-banana';

  // KIE API endpoint
  const KIE_BASE = 'https://api.kie.ai';

  try {
    let requestBody;
    let endpoint;

    if (refs.length > 0) {
      // 有參考圖 → 使用 edit / Pro 的 image_input
      endpoint = isPro
        ? `${KIE_BASE}/api/v1/images/nano-banana-pro`
        : `${KIE_BASE}/api/v1/images/nano-banana-edit`;

      // 把 base64 上傳或直接傳 base64（KIE 支援 base64 image_urls）
      const imageUrls = refs.map(r => `data:${r.mimeType};base64,${r.base64}`);

      requestBody = isPro
        ? {
            prompt,
            image_input: imageUrls,
            aspect_ratio: ratio,
            resolution:   '1K',
            output_format: 'png',
          }
        : {
            prompt,
            image_urls:   imageUrls,
            image_size:   ratio,
            output_format: 'png',
          };
    } else {
      // 純文生圖
      endpoint = isPro
        ? `${KIE_BASE}/api/v1/images/nano-banana-pro`
        : `${KIE_BASE}/api/v1/images/nano-banana`;

      requestBody = isPro
        ? {
            prompt,
            aspect_ratio:  ratio,
            resolution:    '1K',
            output_format: 'png',
          }
        : {
            prompt,
            image_size:    ratio,
            output_format: 'png',
          };
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
      console.error('[image] KIE error:', kieData);
      return res.status(502).json({ error: kieData.message || kieData.error || 'KIE API 錯誤' });
    }

    // KIE 回傳格式：{ data: [{ url }] } 或 { url } 或 { images: [{ url }] }
    let images = [];
    if (kieData.data && Array.isArray(kieData.data)) {
      images = kieData.data.map(d => ({ url: d.url }));
    } else if (kieData.images && Array.isArray(kieData.images)) {
      images = kieData.images.map(d => ({ url: d.url || d }));
    } else if (kieData.url) {
      images = [{ url: kieData.url }];
    } else if (typeof kieData === 'string') {
      images = [{ url: kieData }];
    }

    if (!images.length) {
      console.error('[image] no images in response:', JSON.stringify(kieData).slice(0, 300));
      return res.status(502).json({ error: '生圖成功但沒有收到圖片網址，請稍後再試' });
    }

    return res.status(200).json({ images });

  } catch (e) {
    console.error('[image] exception:', e);
    return res.status(500).json({ error: e.message || '伺服器錯誤' });
  }
}
