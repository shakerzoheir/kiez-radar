export const config = { maxDuration: 30 };

function extractCandidates(title, uploaderName) {
  const candidates = new Set();
  if (uploaderName) candidates.add(uploaderName.trim());

  const cleaned = title
    .replace(/\(?\s*(original mix|extended mix|radio edit|remaster\w*|clip|official\s*(video|audio|lyric)?)\s*\)?/gi, '')
    .replace(/【[^】]*】/g, '')
    .trim();

  const fragments = new Set();

  const atParts = cleaned.split(/\s*@\s*/);
  if (atParts.length > 1) fragments.add(atParts[0].trim());

  const dashParts = cleaned.split(/\s*[-–—]\s*/);
  if (dashParts.length > 1) {
    fragments.add(dashParts[0].trim());
    fragments.add(dashParts[dashParts.length - 1].trim());
  }

  const pipeParts = cleaned.split(/\s*\|\s*/);
  if (pipeParts.length > 1) fragments.add(pipeParts[0].trim());

  fragments.add(cleaned.trim());

  const splitOnCollabs = (str) =>
    str.split(/\s*(?:&|feat\.?|ft\.?|vs\.?|versus|with|w\/)\s*/i)
      .map(s => s.trim()).filter(s => s.length > 1);

  const splitOnX = (str) =>
    str.split(/\s+x\s+/i).map(s => s.trim()).filter(s => s.length > 1);

  for (const frag of [...fragments]) {
    splitOnCollabs(frag).forEach(s => candidates.add(s));
    splitOnX(frag).forEach(s => candidates.add(s));
    const xNoSpace = frag.split(/x(?=[A-Z])/);
    if (xNoSpace.length > 1) xNoSpace.forEach(s => candidates.add(s.trim()));
  }
  fragments.forEach(f => candidates.add(f));

  const noise = new Set([
    'live','set','mix','dj','ep','lp','va','various','premiere','podcast','radio',
    'show','episode','vol','volume','part','pt','the','a','an','and','or','in',
    'at','of','to','for','with','presents','pres','records','recordings','music',
    'audio','video','official','exclusive','free','download','release','new','track'
  ]);

  return [...candidates].filter(c => {
    if (!c || c.length < 2) return false;
    if (/^\d+$/.test(c)) return false;
    if (noise.has(c.toLowerCase())) return false;
    return true;
  });
}

async function getClientId() {
  const pageRes = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
  });
  const pageHtml = await pageRes.text();
  const scriptMatches = pageHtml.match(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g) || [];
  for (const tag of scriptMatches.slice(-3)) {
    const src = tag.match(/src="([^"]+)"/)[1];
    try {
      const jsRes = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const js = await jsRes.text();
      const match = js.match(/client_id:"([a-zA-Z0-9]+)"/);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

async function fetchTracks(userId, clientId, type) {
  const endpoint = type === 'following'
    ? `https://api-v2.soundcloud.com/users/${userId}/followings?client_id=${clientId}&limit=100`
    : `https://api-v2.soundcloud.com/users/${userId}/likes?client_id=${clientId}&limit=100`;

  const items = [];
  let next = endpoint;
  let fetched = 0;
  while (next && fetched < 200) {
    const res = await fetch(next, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    const collection = data.collection || [];
    collection.forEach(item => {
      const track = item.track || item;
      if (track.title || track.username) items.push(track);
    });
    next = data.next_href ? data.next_href + `&client_id=${clientId}` : null;
    fetched += collection.length;
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let { url, type } = req.body || {};
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    // Resolve short URLs
    if (url.includes('on.soundcloud.com')) {
      const redirectRes = await fetch(url, {
        method: 'HEAD', redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      url = redirectRes.url;
    }

    const isProfile = type === 'profile';
    const isLikes = url.includes('/likes');
    const isPlaylist = url.includes('/sets/');
    const isFollowing = url.includes('/following');

    if (!isProfile && !isLikes && !isPlaylist && !isFollowing) {
      return res.status(400).json({ error: 'URL must be a profile, playlist (/sets/), likes (/likes) or following (/following) page' });
    }

    const clientId = await getClientId();
    if (!clientId) return res.status(500).json({ error: 'Could not get SoundCloud client ID' });

    const allCandidates = new Set();
    let totalCount = 0;

    if (isProfile) {
      // Fetch user profile first
      const userRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const user = await userRes.json();
      if (!user.id) return res.status(400).json({ error: 'Could not find SoundCloud profile' });

      // Fetch likes
      const likes = await fetchTracks(user.id, clientId, 'likes');
      likes.forEach(track => {
        extractCandidates(track.title || '', track.user?.username || '')
          .forEach(c => allCandidates.add(c));
      });

      // Fetch following — these are user profiles, just extract usernames
      const following = await fetchTracks(user.id, clientId, 'following');
      following.forEach(u => {
        if (u.username) allCandidates.add(u.username.trim());
        if (u.full_name) allCandidates.add(u.full_name.trim());
      });

      totalCount = likes.length + following.length;

    } else if (isPlaylist) {
      const resolveRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const resolved = await resolveRes.json();
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      const tracks = resolved.tracks || [];
      tracks.forEach(track => {
        extractCandidates(track.title || '', track.user?.username || '')
          .forEach(c => allCandidates.add(c));
      });
      totalCount = tracks.length;

    } else {
      // Likes or following URL directly
      const profileUrl = url.replace('/likes', '').replace('/following', '');
      const userRes = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(profileUrl)}&client_id=${clientId}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const user = await userRes.json();
      if (!user.id) return res.status(400).json({ error: 'Could not find SoundCloud user' });

      const fetchType = isFollowing ? 'following' : 'likes';
      const items = await fetchTracks(user.id, clientId, fetchType);

      if (isFollowing) {
        items.forEach(u => {
          if (u.username) allCandidates.add(u.username.trim());
          if (u.full_name) allCandidates.add(u.full_name.trim());
        });
      } else {
        items.forEach(track => {
          extractCandidates(track.title || '', track.user?.username || '')
            .forEach(c => allCandidates.add(c));
        });
      }
      totalCount = items.length;
    }

    return res.status(200).json({ artists: [...allCandidates], total: totalCount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
