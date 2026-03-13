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

// Fisher-Yates shuffle — 讓各家媒體混合，避免 Claude 偏選同一家
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-firebase-uid');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  // uid 非必要，登入與訪客都可使用

  try {
    const results = await Promise.allSettled(
      RSS_SOURCES.map(async (source) => {
        const r = await fetch(source.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FumeiBot/1.0)' },
          signal: AbortSignal.timeout(8000)
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

    // 洗牌讓各來源混合，避免 Claude 偏選同一家媒體
    shuffle(allItems);

    // 統計各來源筆數
    const sourceCounts = {};
    allItems.forEach(i => { sourceCounts[i.source] = (sourceCounts[i.source]||0)+1; });

    return res.status(200).json({
      items: allItems,
      total: allItems.length,
      sources: sourceCounts,
      errors: errors.length ? errors : undefined,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
