// api/daily-bonus.js
// Vercel Cron Job — 每天 UTC 16:00（台灣時間午夜12點）執行
// 登入用戶：+5點，上限20（兌換碼/購買點數不受限）
// 訪客：+2點，上限20

const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const DAILY_BONUS_USER  = 5;
const DAILY_BONUS_GUEST = 2;
const BASE_CAP = 20; // 基礎點數上限（兌換碼點數另計）

// ── Firestore REST helpers ──────────────────────────────

async function fsQuery(collectionId, fields = ['__name__']) {
  // 用 listDocuments 取得所有文件（分頁，最多300筆）
  const r = await fetch(
    `${FS_BASE}/${collectionId}?key=${FIREBASE_API_KEY}&pageSize=300`,
  );
  if (!r.ok) return [];
  const d = await r.json();
  return d.documents || [];
}

async function fsGet(docPath) {
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
  if (!r.ok) return null;
  const d = await r.json();
  return d.fields || null;
}

async function fsPatch(docPath, fields, maskFields) {
  const mask = maskFields.map(f => `&updateMask.fieldPaths=${f}`).join('');
  const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return r.ok;
}

// ── 主邏輯 ──────────────────────────────────────────────

export default async function handler(req, res) {
  // Vercel Cron 會用 GET，也接受手動觸發
  if (req.method !== 'GET') return res.status(405).end();

  // 安全驗證：只允許 Vercel Cron 或管理員手動觸發
  const authHeader = req.headers['authorization'] || '';
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isAdmin = authHeader === `Bearer ${process.env.CRON_SECRET || 'fumei-cron-2024'}`;
  if (!isCron && !isAdmin) {
    return res.status(401).json({ error: '未授權' });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const results = { users: 0, guests: 0, skipped: 0, errors: 0 };

  // ── 1. 處理登入用戶（users collection）──────────────
  try {
    const userDocs = await fsQuery('users');
    for (const doc of userDocs) {
      try {
        const docPath = doc.name.split('/documents/')[1];
        const data = doc.fields;
        if (!data) continue;

        // 今天已補過就跳過
        const lastBonus = data.last_daily_bonus?.stringValue || '';
        if (lastBonus === today) { results.skipped++; continue; }

        const currentCredits = parseInt(data.fumei_credits?.integerValue ?? '0', 10);
        // 基礎點數部分：min(現有 + 5, 20)
        const bonusCredits = Math.min(currentCredits + DAILY_BONUS_USER, BASE_CAP);
        // 如果現有點數已超過20（兌換碼加的），不動它
        const newCredits = currentCredits >= BASE_CAP ? currentCredits : bonusCredits;

        await fsPatch(docPath, {
          fumei_credits:    { integerValue: String(newCredits) },
          last_daily_bonus: { stringValue: today },
        }, ['fumei_credits', 'last_daily_bonus']);

        results.users++;
      } catch(e) {
        results.errors++;
      }
    }
  } catch(e) {
    console.error('[daily-bonus] users error:', e);
  }

  // ── 2. 處理訪客（guest_credits collection）──────────
  try {
    const guestDocs = await fsQuery('guest_credits');
    for (const doc of guestDocs) {
      try {
        const docPath = doc.name.split('/documents/')[1];
        const data = doc.fields;
        if (!data) continue;

        const lastBonus = data.last_daily_bonus?.stringValue || '';
        if (lastBonus === today) { results.skipped++; continue; }

        const current = parseInt(data.credits?.integerValue ?? '0', 10);
        const newCredits = Math.min(current + DAILY_BONUS_GUEST, BASE_CAP);

        await fsPatch(docPath, {
          credits:          { integerValue: String(newCredits) },
          last_daily_bonus: { stringValue: today },
          updated_at:       { stringValue: new Date().toISOString() },
        }, ['credits', 'last_daily_bonus', 'updated_at']);

        results.guests++;
      } catch(e) {
        results.errors++;
      }
    }
  } catch(e) {
    console.error('[daily-bonus] guests error:', e);
  }

  console.log(`[daily-bonus] ${today}`, results);
  return res.status(200).json({ date: today, ...results });
}
