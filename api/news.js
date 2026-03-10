// api/news.js — 台灣新聞 RSS 爬蟲
// 抓多個新聞網站 RSS，回傳最新標題清單

const RSS_SOURCES = [
  { name: 'ETtoday',  url: 'https://feeds.feedburner.com/ettoday/realtime' },
  { name: '自由時報',  url: 'https://news.ltn.com.tw/rss/all.xml' },
  { name: '三立新聞',  url: 'https://www.setn.com/rss.aspx' },
  { name: '聯合新聞網', url: 'https://udn.com/rssfeed/news/2/6638' },
];

// 簡易 XML 標題解析（不依賴外部套件）
function parseTitles(xml, maxPerSource = 8) {
  const titles = [];
  const regex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
  let match;
  let count = 0;
  while ((match = regex.exec(xml)) !== null && count < maxPerSource) {
    const t = (match[1] || match[2] || '').trim();
    // 過濾掉 RSS 頻道本身的標題（通常很短或是網站名稱）
    if (t.length > 8 && !t.includes('RSS') && !t.includes('新聞網') && !t.includes('ETtoday新聞雲')) {
      titles.push(t);
      count++;
    }
  }
  return titles;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  // 只需要登入驗證，不需要指紋（新聞是公開資料）
  const uid = req.headers['x-firebase-uid'];
  if (!uid) return res.status(401).json({ error: '請先登入' });

  try {
    // 並行抓所有 RSS，單一失敗不影響其他
    const results = await Promise.allSettled(
      RSS_SOURCES.map(async (source) => {
        const r = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiBot/1.0)' },
          signal: AbortSignal.timeout(5000) // 5 秒 timeout
        });
        if (!r.ok) throw new Error(`${source.name} HTTP ${r.status}`);
        const xml = await r.text();
        const titles = parseTitles(xml, 8);
        return { source: source.name, titles };
      })
    );

    const allTitles = [];
    const errors = [];

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value.titles.forEach(t => allTitles.push({ title: t, source: r.value.source }));
      } else {
        errors.push(`${RSS_SOURCES[i].name}: ${r.reason?.message}`);
      }
    });

    return res.status(200).json({
      titles: allTitles,
      total: allTitles.length,
      errors: errors.length ? errors : undefined,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
