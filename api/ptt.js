// api/ptt.js — Fumei Studio PTT 熱門文章 API
const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const PTT_BASE = 'https://www.ptt.cc';

// 正確的 PTT 看板名稱對照表
const BOARD_MAP = {
  gossiping:    'Gossiping',
  joke:         'joke',
  c_chat:       'C_Chat',
  'boy-girl':   'Boy-Girl',
  hatepolitics: 'HatePolitics',
  stupidclown:  'StupidClown',
  tech_job:     'Tech_Job',
  // 舊板保留相容（防止舊快取或連結）
  womenhating:  'WomenTalk',
  marriage:     'marriage',
  lifeismoney:  'Lifeismoney',
};

async function fsIncrement(docPath, field) {
  try {
    const r = await fetch(`${FS_BASE}/${docPath}?key=${FIREBASE_API_KEY}`);
    if (!r.ok) return;
    const d = await r.json();
    const cur = parseInt(d.fields?.[field]?.integerValue || '0', 10);
    await fetch(`${FS_BASE}/${docPath}?updateMask.fieldPaths=${field}&key=${FIREBASE_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [field]: { integerValue: String(cur + 1) } } }),
    });
  } catch(e) {}
}

function parsePttIndex(html) {
  const items = [];
  const entRegex = /<div class="r-ent">([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = entRegex.exec(html)) !== null) {
    const block = m[1];

    const nrecMatch = block.match(/<div class="nrec"><span[^>]*>([^<]*)<\/span>/);
    let pushCount = 0;
    if (nrecMatch) {
      const s = nrecMatch[1].trim();
      if (s === '爆') pushCount = 99;
      else if (s.startsWith('X')) pushCount = -10;
      else pushCount = parseInt(s) || 0;
    }

    const linkMatch = block.match(/<a href="(\/bbs\/[^"]+)"[^>]*>([^<]+)<\/a>/);
    if (!linkMatch) continue;
    const href  = linkMatch[1];
    const title = linkMatch[2].trim();

    const authorMatch = block.match(/<div class="author">([^<]*)<\/div>/);
    const author = authorMatch ? authorMatch[1].trim() : '';

    const dateMatch = block.match(/<div class="date">\s*([^<]+)<\/div>/);
    const date = dateMatch ? dateMatch[1].trim() : '';

    if (title.startsWith('(本文已被刪除)') || title.startsWith('[刪除]')) continue;

    items.push({ title, href, pushCount, author, date });
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid      = req.headers['x-firebase-uid'];
  const boardKey = (req.query.board || 'gossiping').toLowerCase();
  const board    = BOARD_MAP[boardKey] || 'Gossiping';
  // 較冷門的板門檻降低，避免抓不到文章
  const smallBoards = ['joke', 'stupidclown', 'tech_job', 'boy-girl', 'womenhating', 'marriage'];
  const tinyBoards = ['stupidclown', 'womenhating']; // 這兩板發文量少，門檻設最低
  const defaultMinPush = tinyBoards.includes(boardKey) ? 1 : smallBoards.includes(boardKey) ? 5 : 10;
  const minPush  = parseInt(req.query.minPush || String(defaultMinPush));
  const defaultPages = tinyBoards.includes(boardKey) ? 5 : 3;
  const pages    = Math.min(parseInt(req.query.pages || String(defaultPages)), 5);

  try {
    let allItems = [];
    let url = `${PTT_BASE}/bbs/${board}/index.html`;

    for (let i = 0; i < pages; i++) {
      const r = await fetch(url, {
        headers: {
          'Cookie': 'over18=1',
          'User-Agent': 'Mozilla/5.0 (compatible; FumeiStudio/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9',
        },
      });
      if (!r.ok) {
        console.error(`[ptt] fetch ${url} failed: ${r.status}`);
        break;
      }
      const html = await r.text();

      // 判斷是否被導向 over18 驗證頁（要是真的驗證頁，不是含有 over18 字的正常頁）
      if (html.includes('請問您是否已滿十八歲') || html.includes('age-check') || html.includes('您必須年滿')) {
        console.error('[ptt] over18 check triggered');
        break;
      }

      const items = parsePttIndex(html);
      allItems = allItems.concat(items);

      const prevMatch = html.match(/<a[^>]+href="(\/bbs\/[^"]+index\d+\.html)"[^>]*>\s*‹ 上頁/);
      if (!prevMatch) break;
      url = PTT_BASE + prevMatch[1];
    }

    const seen = new Set();
    const hot = allItems
      .filter(a => {
        if (seen.has(a.href)) return false;
        seen.add(a.href);
        return a.pushCount >= minPush;
      })
      .sort((a, b) => b.pushCount - a.pushCount)
      .slice(0, 30)
      .map(a => ({
        title:     a.title,
        pushCount: a.pushCount,
        author:    a.author,
        date:      a.date,
        url:       PTT_BASE + a.href,
        source:    `PTT/${board}`,
      }));

    if (uid) fsIncrement(`users/${uid}`, 'usage_ptt').catch(() => {});

    return res.status(200).json({ items: hot, board, total: hot.length });
  } catch(e) {
    console.error('[ptt] error:', e.message);
    return res.status(500).json({ error: e.message, items: [] });
  }
}
