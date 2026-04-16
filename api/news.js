// api/news.js — Fumei Studio 新聞 API（Google News RSS + 分類支援）
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

// Google News RSS URL builder
// topic IDs: https://support.google.com/news/publisher-center/answer/9606710
const CATEGORY_TOPICS = {
  all:           null,                                          // 台灣頭條（預設）
  politics:      'CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFZxYUdjU0FtZHZLQUFQAQ',  // 政治
  society:       'CAAqJQgKIh9DQkFTRVFvSUwyMHZNRFp1ZUdZU0JXVnVMVWRDTWlBQVAB',  // 社會
  finance:       'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtZHZHZ0FQAQ',  // 財經
  lifestyle:     'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR28wY0dZU0FtZHZLQUFQAQ',  // 生活
  world:         'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtZHZHZ0FQAQ',  // 國際（用科技近似）
  entertainment: 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QyY0dZU0FtZHZLQUFQAQ',  // 娛樂
  sports:        'CAAqJggKIiBDQkFTRWdvSUwyMHZNVEl3Y0dZU0FtZHZHZ0FQAQ',  // 體育
  education:     null,                                          // 文教（回落一般搜尋）
};

// 關鍵字過濾（當 topic ID 無效時的備援）
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

function buildRssUrl(category) {
  // 今天日期，格式 YYYY-MM-DD（Google News after: 參數）
  const today = new Date().toISOString().slice(0, 10);
  const topicId = CATEGORY_TOPICS[category];
  if (topicId) {
    // 有 topic ID：用 Google News topic RSS
    return `https://news.google.com/rss/topics/${topicId}?hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  }
  // 沒有 topic ID：用關鍵字搜尋 RSS，加 after: 限制今天
  const baseQ = CATEGORY_QUERY[category] || 'tw';
  const q = encodeURIComponent(`${baseQ} after:${today}`);
  return `https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const uid = req.headers['x-firebase-uid'];
  const category = req.query.category || 'all';

  try {
    const rssUrl = buildRssUrl(category);
    const r = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiStudio/1.0)' },
    });
    if (!r.ok) throw new Error(`RSS fetch failed: ${r.status}`);
    const xml = await r.text();

    // 解析 RSS XML
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     block.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
      // Google News RSS 的 <link> 是自閉合空標籤，真正 URL 在 <guid>
      const link  = (block.match(/<guid[^>]*>(.*?)<\/guid>/) ||
                     block.match(/<link>(.*?)<\/link>/) ||
                     block.match(/<link\s+href="(.*?)"/))?.[1]?.trim() || '';
      const source = (block.match(/<source[^>]*>(.*?)<\/source>/))?.[1]?.trim() ||
                     (block.match(/<source[^>]*url="[^"]*"[^>]*>(.*?)<\/source>/))?.[1]?.trim() || '未知來源';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';

      if (title && title.length > 5) {
        items.push({ title, link, source, pubDate });
      }
      if (items.length >= 30) break;
    }

    // 只保留 36 小時內的新聞（今日時事要新鮮）
    const twoDaysAgo = Date.now() - 36 * 60 * 60 * 1000;
    const recentItems = items.filter(item => {
      if (!item.pubDate) return true;
      const pub = new Date(item.pubDate).getTime();
      return isNaN(pub) || pub >= twoDaysAgo;
    });
    const finalItems = recentItems.length >= 3 ? recentItems : items; // 過濾後太少就用全部

    if (uid) fsIncrement(`users/${uid}`, 'usage_news').catch(() => {});

    return res.status(200).json({ items: finalItems, category, total: finalItems.length });
  } catch(e) {
    console.error('[news] error:', e.message);
    return res.status(500).json({ error: e.message, items: [] });
  }
}
