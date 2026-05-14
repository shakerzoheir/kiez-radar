export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    await fetch(`${kvUrl}/set/ping/pong`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${kvToken}` },
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
