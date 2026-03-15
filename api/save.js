import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // Verify the session token from Authorization header
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = await clerk.verifyToken(token);
    const userId = payload.sub;

    const { artists } = req.body;
    if (!Array.isArray(artists)) return res.status(400).json({ error: 'artists must be an array' });

    // Save to Vercel KV via REST API
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;

    const response = await fetch(`${kvUrl}/set/user:${userId}:artists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(artists) }),
    });

    if (!response.ok) throw new Error('Failed to save to KV');

    return res.status(200).json({ success: true, count: artists.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
