// api/checkout.js — Fumei Studio 綠界金流
// POST /api/checkout        → 建立訂單，回傳綠界付款表單 HTML
// POST /api/checkout?notify → 接收綠界付款結果通知，補點數

import crypto from 'crypto';

const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// 綠界環境設定（正式）
const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY    = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV     = process.env.ECPAY_HASH_IV;
const ECPAY_API_URL     = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

// 點數方案
const PLANS = {
  starter: { label: '50點方案',  points: 50,  amount: 49  },
  basic:   { label: '120點方案', points: 120, amount: 99  },
  pro:     { label: '300點方案', points: 300, amount: 199 },
  mega:    { label: '700點方案', points: 700, amount: 399 },
};

// ── 工具函式 ──────────────────────────────────────

function genMerchantTradeNo() {
  // 綠界訂單號：最多20碼，英數字
  const now = Date.now().toString(36).toUpperCase();
  return `FM${now}`.slice(0, 20);
}

function formatDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function genCheckMacValue(params) {
  // 步驟：按 key 字母排序 → 組成 query string → URL encode → SHA256
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  let str = `HashKey=${ECPAY_HASH_KEY}&` +
    Object.entries(sorted).map(([k,v]) => `${k}=${v}`).join('&') +
    `&HashIV=${ECPAY_HASH_IV}`;
  // URL encode（綠界規則）
  str = encodeURIComponent(str)
    .replace(/%2d/gi, '-')
    .replace(/%5f/gi, '_')
    .replace(/%2e/gi, '.')
    .replace(/%21/gi, '!')
    .replace(/%2a/gi, '*')
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%20/gi, '+')
    .toLowerCase();
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

async function fsGet(docPath) {
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
  if (!r.ok) return null;
  const d = await r.json();
  return d.fields || null;
}

async function fsUpdate(docPath, fields) {
  const fieldPaths = Object.keys(fields).join(',');
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number') body.fields[k] = { integerValue: String(v) };
    else body.fields[k] = { stringValue: String(v) };
  }
  await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${fieldPaths}&key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Handler ──────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!ECPAY_MERCHANT_ID || !ECPAY_HASH_KEY || !ECPAY_HASH_IV) {
    return res.status(500).json({ error: '綠界環境變數未設定' });
  }

  // ── 付款結果通知（綠界 POST 回來）────────────────
  if (req.query.notify === '') {
    const body = req.body || {};
    const { MerchantTradeNo, RtnCode, CustomField1: uid, CustomField2: planKey, CheckMacValue } = body;

    // 驗證檢查碼
    const verifyParams = { ...body };
    delete verifyParams.CheckMacValue;
    const expected = genCheckMacValue(verifyParams);
    if (expected !== CheckMacValue) {
      console.error('[checkout] CheckMacValue mismatch');
      return res.status(200).send('0|ErrorCheckMacValue');
    }

    // RtnCode === '1' 代表付款成功
    if (RtnCode === '1' && uid && planKey && PLANS[planKey]) {
      try {
        const plan = PLANS[planKey];
        const data = await fsGet(`users/${uid}`);
        const current = parseInt(data?.fumei_credits?.integerValue || '0', 10);
        const newCredits = current + plan.points;

        // 補點數
        await fsUpdate(`users/${uid}`, {
          fumei_credits: newCredits,
          [`fumei_purchase_${MerchantTradeNo}`]: JSON.stringify({
            plan: planKey,
            points: plan.points,
            price: plan.amount,
            at: new Date().toISOString(),
            tradeNo: MerchantTradeNo,
          }),
        });

        console.log(`[checkout] ✅ 補點成功 uid=${uid} plan=${planKey} +${plan.points}點`);
      } catch(e) {
        console.error('[checkout] 補點失敗:', e.message);
        return res.status(200).send('0|ServerError');
      }
    }

    return res.status(200).send('1|OK');
  }

  // ── 建立訂單（前端呼叫）──────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { planKey, uid } = req.body || {};
  if (!planKey || !PLANS[planKey]) return res.status(400).json({ error: '無效的方案' });
  if (!uid) return res.status(401).json({ error: '請先登入' });

  const plan = PLANS[planKey];
  const tradeNo = genMerchantTradeNo();
  const tradeDate = formatDate(new Date());

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fumei-studio.com';

  const params = {
    MerchantID:        ECPAY_MERCHANT_ID,
    MerchantTradeNo:   tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType:       'aio',
    TotalAmount:       String(plan.amount),
    TradeDesc:         encodeURIComponent('Fumei Studio 點數'),
    ItemName:          `${plan.label}`,
    ReturnURL:         `${baseUrl}/api/checkout?notify`,
    OrderResultURL:    `https://fumei-studio.com/payment-success`,
    ChoosePayment:     'Credit',
    EncryptType:       '1',
    CustomField1:      uid,
    CustomField2:      planKey,
  };

  params.CheckMacValue = genCheckMacValue(params);

  // 回傳自動 submit 的 HTML 表單
  const formHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>前往付款...</title></head>
<body>
<p style="font-family:sans-serif;text-align:center;margin-top:80px;color:#aaa">正在跳轉至綠界付款頁面...</p>
<form id="f" method="POST" action="${ECPAY_API_URL}">
${Object.entries(params).map(([k,v]) => {
  // HTML escape：uid 由 client 帶入，不 escape 會 attribute breakout
  const safe = String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<input type="hidden" name="${k}" value="${safe}">`;
}).join('\n')}
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;

  return res.status(200).json({ formHtml, tradeNo });
}
