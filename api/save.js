export const config = { maxDuration: 10 };

function getUserId(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!decoded.sub) throw new Error('No sub');
    if (decoded.exp < Date.now() / 1000) throw new Error('Expired');
    return decoded.sub;
  } catch(e) {
    throw new Error('Invalid token: ' + e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    const userId = getUserId(token);
    const { artists } = req.body;
    if (!Array.isArray(artists)) return res.status(400).json({ error: 'artists must be array' });

    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    const key = `user:${userId}:artists`;
    const value = JSON.stringify(artists);

    const response = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${kvToken}` },
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    return res.status(200).json({ success: true, count: artists.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
