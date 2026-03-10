export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const authHeader = req.headers['x-firebase-uid'];
  if (!authHeader) {
    return res.status(401).json({ error: '請先登入' });
  }

  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) {
    return res.status(500).json({ error: 'Server config error' });
  }

  try {
    const body = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        ...(body.tools?.some(t => t.type === 'web_search_20250305')
          ? { 'anthropic-beta': 'web-search-2025-03-05' }
          : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
