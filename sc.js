export const config = { maxDuration: 30 };

// Extract all candidate artist names from a track title
function extractCandidates(title, uploaderName) {
  const candidates = new Set();

  // Always add uploader
  if (uploaderName) candidates.add(uploaderName.trim());

  // Clean title — remove common noise suffixes first
  const cleaned = title
    .replace(/\(?\s*(original mix|extended mix|radio edit|remaster\w*|clip|official\s*(video|audio|lyric)?)\s*\)?/gi, '')
    .replace(/【[^】]*】/g, '')
    .trim();

  // Split strategies — each produces fragments to test
  const fragments = new Set();

  // 1. Before @ (venue marker): "Artist @ Venue" → Artist
  const atParts = cleaned.split(/\s*@\s*/);
  if (atParts.length > 1) fragments.add(atParts[0].trim());

  // 2. Before first - / – / — : "Artist - Title"
  const dashParts = cleaned.split(/\s*[-–—]\s*/);
  if (dashParts.length > 1) {
    // Everything before first dash
    fragments.add(dashParts[0].trim());
    // Everything after last dash (sometimes "Title - Artist" format)
    fragments.add(dashParts[dashParts.length - 1].trim());
  }

  // 3. Pipe separator: "Artist | Label"
  const pipeParts = cleaned.split(/\s*\|\s*/);
  if (pipeParts.length > 1) fragments.add(pipeParts[0].trim());

  // 4. Add full cleaned title as a candidate
  fragments.add(cleaned.trim());

  // 5. For each fragment, further split on & / feat. / ft. / vs. / x (as word boundary)
  const splitOnCollabs = (str) => {
    return str
      .split(/\s*(?:&|feat\.?|ft\.?|vs\.?|versus|with|w\/)\s*/i)
      .map(s => s.trim())
      .filter(s => s.length > 1);
  };

  // Also split on standalone 'x' between words (e.g. "KimSwimxOppidan" or "Kim Swim x Oppidan")
  const splitOnX = (str) => {
    return str
      .split(/\s+x\s+/i)
      .map(s => s.trim())
      .filter(s => s.length > 1);
  };

  for (const frag of [...fragments]) {
    splitOnCollabs(frag).forEach(s => candidates.add(s));
    splitOnX(frag).forEach(s => candidates.add(s));
    // Also try splitting the x-joined version without spaces e.g. "ArtistxArtist"
    const xNoSpace = frag.split(/x(?=[A-Z])/);
    if (xNoSpace.length > 1) xNoSpace.forEach(s => candidates.add(s.trim()));
  }

  // Add all fragments too
  fragments.forEach(f => candidates.add(f));

  // Filter out obviously non-artist strings
  const noise = new Set([
    'live', 'set', 'mix', 'dj', 'ep', 'lp', 'va', 'various', 'premiere',
    'podcast', 'radio', 'show', 'episode', 'vol', 'volume', 'part', 'pt',
    'the', 'a', 'an', 'and', 'or', 'in', 'at', 'of', 'to', 'for', 'with',
    'presents', 'pres', 'records', 'recordings', 'music', 'audio', 'video',
    'official', 'exclusive', 'free', 'download', 'release', 'new', 'track'
  ]);

  return [...candidates].filter(c => {
    if (!c || c.length < 2) return false;
    if (/^\d+$/.test(c)) return false; // pure numbers
    if (noise.has(c.toLowerCase())) return false;
    return true;
  });
}

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
      const resolveRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const resolved = await resolveRes.json();
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      tracks = resolved.tracks || [];
    } else {
      const userRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url.replace('/likes', ''))}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const user = await userRes.json();
      if (!user.id) return res.status(400).json({ error: 'Could not find SoundCloud user' });

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

    // Extract all candidates from every track
    const allCandidates = new Set();
    tracks.forEach(track => {
      const candidates = extractCandidates(track.title || '', track.user?.username || '');
      candidates.forEach(c => allCandidates.add(c));
    });

    return res.status(200).json({ artists: [...allCandidates], total: tracks.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
