export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    // Resolve short URLs (on.soundcloud.com/...)
    if (url.includes('on.soundcloud.com')) {
      const redirectRes = await fetch(url, {
        method: 'HEAD', redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      url = redirectRes.url;
    }

    // Detect type
    const isLikes = url.includes('/likes');
    const isPlaylist = url.includes('/sets/');
    if (!isLikes && !isPlaylist) {
      return res.status(400).json({ error: 'URL must be a SoundCloud playlist (/sets/) or likes (/likes) page' });
    }

    // Get client_id from SoundCloud's page
    const pageRes = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });
    const pageHtml = await pageRes.text();
    const scriptMatches = pageHtml.match(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g) || [];
    let clientId = null;
    for (const tag of scriptMatches.slice(-3)) {
      const src = tag.match(/src="([^"]+)"/)[1];
      try {
        const jsRes = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const js = await jsRes.text();
        const match = js.match(/client_id:"([a-zA-Z0-9]+)"/);
        if (match) { clientId = match[1]; break; }
      } catch {}
    }
    if (!clientId) return res.status(500).json({ error: 'Could not get SoundCloud client ID' });

    let tracks = [];

    if (isPlaylist) {
      // Resolve playlist
      const resolveRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const resolved = await resolveRes.json();
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      tracks = resolved.tracks || [];
    } else {
      // Fetch likes — need user ID first
      const userRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url.replace('/likes',''))}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const user = await userRes.json();
      if (!user.id) return res.status(400).json({ error: 'Could not find SoundCloud user' });

      // Fetch likes (paginated, up to 200)
      let next = `https://api-v2.soundcloud.com/users/${user.id}/likes?client_id=${clientId}&limit=100`;
      let fetched = 0;
      while (next && fetched < 200) {
        const likesRes = await fetch(next, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const likesData = await likesRes.json();
        const items = likesData.collection || [];
        items.forEach(item => {
          const track = item.track || item;
          if (track.title) tracks.push(track);
        });
        next = likesData.next_href ? likesData.next_href + `&client_id=${clientId}` : null;
        fetched += items.length;
      }
    }

    // Extract artist names
    const artists = new Set();
    tracks.forEach(track => {
      const title = track.title || '';
      const user = track.user?.username || '';
      const dashMatch = title.match(/^(.+?)\s*[-–—]\s*.+/);
      if (dashMatch) artists.add(dashMatch[1].trim());
      if (user) artists.add(user);
    });

    return res.status(200).json({ artists: [...artists], total: tracks.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
