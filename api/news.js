// api/news.js — Fumei Studio 新聞 API（Google News RSS + Google Trends RSS）
const FIREBASE_PROJECT = 'fumei-3e684';
const FIREBASE_API_KEY = 'AIzaSyBQqFVSpTHDvrwbgtwuDOyFWbfSwhE7rCY';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

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

// ── Google News 關鍵字搜尋 RSS ─────────────────────
const CATEGORY_QUERY = {
  all:           'tw',
  politics:      '台灣 政治 選舉 立法院',
  society:       '台灣 社會 民生',
  finance:       '台灣 財經 股市 經濟',
  lifestyle:     '台灣 消費 生活 健康',
  world:         '國際 外交 美國 中國',
  entertainment: '台灣 娛樂 藝人 明星',
  sports:        '台灣 體育 棒球 籃球',
  education:     '台灣 教育 文化',
};

function buildNewsRssUrl(category) {
  const today = new Date().toISOString().slice(0, 10);
  const baseQ = CATEGORY_QUERY[category] || 'tw';
  const q = encodeURIComponent(`${baseQ} after:${today}`);
  return `https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
}

// ── Google Trends 台灣即時熱搜 RSS ─────────────────
const TRENDS_RSS_URL = 'https://trends.google.com.tw/trending/rss?geo=TW';

// ── RSS XML 解析工具 ───────────────────────────────
function parseNewsRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   block.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
    const link  = (block.match(/<guid[^>]*>(.*?)<\/guid>/) ||
                   block.match(/<link>(.*?)<\/link>/) ||
                   block.match(/<link\s+href="(.*?)"/))?.[1]?.trim() || '';
    const source = (block.match(/<source[^>]*>(.*?)<\/source>/))?.[1]?.trim() || '未知來源';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';
    if (title && title.length > 5) {
      items.push({ title, link, source, pubDate });
    }
    if (items.length >= 30) break;
  }
  return items;
}

function parseTrendsRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   block.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
    const link  = (block.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';
    // Trends 的 ht:approx_traffic 表示搜尋量
    const traffic = (block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/))?.[1]?.trim() || '';
    if (title && title.length >= 2) {
      items.push({ title, link, source: '🔥 Google 熱搜', pubDate, traffic });
    }
    if (items.length >= 20) break;
  }
  return items;
}

// ── 標題去重（CJK bigram 40% 交集 = 同事件）────────
function titleBigrams(t) {
  const cjk = t.replace(/[^\u4e00-\u9fff]/g, '');
  const s = new Set();
  for (let i = 0; i < cjk.length - 1; i++) s.add(cjk.slice(i, i + 2));
  return s;
}
function isSimilarTitle(a, b) {
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  a.forEach(g => { if (b.has(g)) overlap++; });
  return overlap / Math.min(a.size, b.size) >= 0.4;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = req.headers['x-firebase-uid'];
  const category = req.query.category || 'all';

  try {
    // ── 同時抓 Google News + Google Trends ──────────
    const newsUrl = buildNewsRssUrl(category);
    const [newsRes, trendsRes] = await Promise.allSettled([
      fetch(newsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiStudio/1.0)' } }),
      fetch(TRENDS_RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiStudio/1.0)' } }),
    ]);

    // 解析 Google News
    let newsItems = [];
    if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
      const xml = await newsRes.value.text();
      newsItems = parseNewsRss(xml);
    }

    // 解析 Google Trends（台灣熱搜）
    let trendsItems = [];
    if (trendsRes.status === 'fulfilled' && trendsRes.value.ok) {
      const xml = await trendsRes.value.text();
      trendsItems = parseTrendsRss(xml);
    }

    // ── 時間過濾：只保留 36 小時內且有日期的 ─────────
    const cutoffMs = Date.now() - 36 * 60 * 60 * 1000;
    function isRecent(item) {
      if (!item.pubDate) return false;
      const pub = new Date(item.pubDate).getTime();
      return !isNaN(pub) && pub >= cutoffMs;
    }
    const recentNews = newsItems.filter(isRecent);
    // Trends 通常都是今天的，但也做過濾
    const recentTrends = trendsItems.filter(item => {
      if (!item.pubDate) return true; // Trends 沒日期也放行（本身就是即時的）
      const pub = new Date(item.pubDate).getTime();
      return isNaN(pub) || pub >= cutoffMs;
    });

    // ── 合併：Trends 放最前面（代表「大家真正在搜」），News 補後面 ──
    const combined = [...recentTrends, ...(recentNews.length >= 3 ? recentNews : newsItems)];

    // ── 去重 ────────────────────────────────────────
    const keptGrams = [];
    const deduped = combined.filter(item => {
      const g = titleBigrams(item.title);
      if (keptGrams.some(kg => isSimilarTitle(g, kg))) return false;
      keptGrams.push(g);
      return true;
    });

    // 每家來源最多 3 則
    const capPerSource = {};
    const finalItems = deduped.filter(item => {
      capPerSource[item.source] = (capPerSource[item.source] || 0) + 1;
      return capPerSource[item.source] <= 3;
    });

    if (uid) fsIncrement(`users/${uid}`, 'usage_news').catch(() => {});

    return res.status(200).json({
      items: finalItems,
      category,
      total: finalItems.length,
      sources: { news: recentNews.length, trends: recentTrends.length },
    });
  } catch(e) {
    console.error('[news] error:', e.message);
    return res.status(500).json({ error: e.message, items: [] });
  }
}
