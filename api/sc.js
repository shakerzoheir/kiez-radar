export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    // Resolve the SoundCloud client_id from their page
    const pageRes = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });
    const pageHtml = await pageRes.text();
    // Extract client_id from their JS bundle URLs
    const scriptMatch = pageHtml.match(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g);
    let clientId = null;
    if (scriptMatch) {
      for (const tag of scriptMatch.slice(-3)) {
        const src = tag.match(/src="([^"]+)"/)[1];
        try {
          const jsRes = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const js = await jsRes.text();
          const match = js.match(/client_id:"([a-zA-Z0-9]+)"/);
          if (match) { clientId = match[1]; break; }
        } catch {}
      }
    }
    if (!clientId) return res.status(500).json({ error: 'Could not get SoundCloud client ID' });

    // Resolve the playlist URL
    const resolveRes = await fetch(
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const resolved = await resolveRes.json();
    if (resolved.error || !resolved.tracks) {
      return res.status(400).json({ error: resolved.error || 'Not a valid playlist URL' });
    }

    // Extract artist names from track titles
    const tracks = resolved.tracks || [];
    const artists = new Set();
    tracks.forEach(track => {
      const title = track.title || '';
      const user = track.user?.username || '';
      // Primary: artist from title (Artist - Title format)
      const dashMatch = title.match(/^(.+?)\s*[-–—]\s*.+/);
      if (dashMatch) artists.add(dashMatch[1].trim());
      // Also add the uploader
      if (user) artists.add(user);
    });

    return res.status(200).json({ artists: [...artists], total: tracks.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
