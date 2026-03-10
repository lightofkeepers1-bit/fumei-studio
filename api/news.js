// api/news.js — 台灣新聞 RSS 爬蟲
// 抓多個新聞網站 RSS，回傳標題 + 連結 + 時間

const RSS_SOURCES = [
  { name: 'ETtoday',   url: 'https://feeds.feedburner.com/ettoday/realtime' },
  { name: '自由時報',   url: 'https://news.ltn.com.tw/rss/all.xml' },
  { name: '三立新聞',   url: 'https://www.setn.com/rss.aspx' },
  { name: '聯合新聞網', url: 'https://udn.com/rssfeed/news/2/6638' },
];

function parseItems(xml, sourceName, maxPerSource = 8) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null && items.length < maxPerSource) {
    const block = itemMatch[1];
    const titleMatch = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                       block.match(/<title>(.*?)<\/title>/);
    const title = (titleMatch?.[1] || '').trim();
    const linkMatch = block.match(/<link>(https?:\/\/[^<]+)<\/link>/) ||
                      block.match(/<guid[^>]*isPermaLink="true"[^>]*>(https?:\/\/[^<]+)<\/guid>/) ||
                      block.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/);
    const url = (linkMatch?.[1] || '').trim();
    const dateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);
    const pubDate = (dateMatch?.[1] || '').trim();
    if (title.length > 8 && url.startsWith('http')) {
      items.push({ title, url, pubDate, source: sourceName });
    }
  }
  return items;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  const uid = req.headers['x-firebase-uid'];
  if (!uid) return res.status(401).json({ error: '請先登入' });
  try {
    const results = await Promise.allSettled(
      RSS_SOURCES.map(async (source) => {
        const r = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiBot/1.0)' },
          signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) throw new Error(`${source.name} HTTP ${r.status}`);
        const xml = await r.text();
        return parseItems(xml, source.name, 8);
      })
    );
    const allItems = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') allItems.push(...r.value);
      else errors.push(`${RSS_SOURCES[i].name}: ${r.reason?.message}`);
    });
    return res.status(200).json({
      items: allItems,
      total: allItems.length,
      errors: errors.length ? errors : undefined,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
