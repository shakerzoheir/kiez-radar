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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    const userId = getUserId(token);

    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    const key = `user:${userId}:artists`;

    const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { 'Authorization': `Bearer ${kvToken}` },
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    const artists = data.result ? JSON.parse(data.result) : null;
    return res.status(200).json({ artists });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
