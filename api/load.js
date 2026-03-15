import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = await clerk.verifyToken(token);
    const userId = payload.sub;

    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    const key = `user:${userId}:artists`;

    // Upstash REST API: GET /get/key
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
