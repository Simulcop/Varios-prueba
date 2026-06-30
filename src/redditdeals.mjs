// Lee deals de subreddits de ofertas (por defecto r/VinylDeals): RSS Atom nativo,
// gratis y permanente, con mucho volumen. Cada post trae en el TITULO la tienda,
// el artista - album y el precio; y en el CUERPO el enlace de Amazon (US, /dp/).
//
// Filtramos a Amazon US y extraemos artista/album/precio/enlace. El genero/sello
// los completa el enriquecimiento (Discogs/MusicBrainz).
//
// Config: REDDIT_FEEDS (urls .rss separadas por coma). "none" lo desactiva.

const UA = 'vinyl-deal-radar/1.0 (+https://github.com/Simulcop/Varios-prueba)';
const DEFAULT_FEEDS = ['https://www.reddit.com/r/VinylDeals/new/.rss'];

function feedList() {
  const raw = process.env.REDDIT_FEEDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_FEEDS;
  if (raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

// Elige el mejor enlace de Amazon US del cuerpo (decodificado).
function pickAmazon(html) {
  const dp = html.match(/https?:\/\/(?:www\.)?amazon\.com\/[^\s"'<>]*\/dp\/[A-Z0-9]+/i);
  if (dp) return dp[0];
  const any = html.match(/https?:\/\/(?:www\.)?amazon\.com\/[^\s"'<>]+/i);
  if (any) return any[0].replace(/[).,]+$/, '');
  const short = html.match(/https?:\/\/amzn\.(?:to|eu)\/[A-Za-z0-9]+/i);
  return short ? short[0] : null;
}

// De un titulo "(Amazon) [Regional] Artista - Album @ $19.99" saca los campos.
function parseTitle(rawTitle) {
  let t = decodeEntities(rawTitle).trim();

  // Tags iniciales entre [] o (): tienda y region.
  const lead = (t.match(/^\s*(?:[[(][^\])]*[\])]\s*)+/) || [''])[0];
  // Solo Amazon US: tag exacto "Amazon" (excluye "Amazon UK/CA") o "Regional" (cupon US).
  const usAmazon = /[[(]\s*amazon\s*[\])]/i.test(lead) || /\bregional\b/i.test(lead);

  t = t.replace(/^\s*(?:[[(][^\])]*[\])]\s*)+/, '').trim();

  // Precio: ultimo importe $1,234.56 (evita falsos como "Too $hort").
  const prices = [...t.matchAll(/\$\s*([\d,]+\.\d{2})\b/g)].map((m) => parseFloat(m[1].replace(/,/g, '')));
  const price = prices.length ? prices[prices.length - 1] : null;

  // Quita el precio del final (con su @ o - delante) para quedarnos con el titulo.
  t = t.replace(/\s*[@–-]?\s*\$\s*[\d,]+\.\d{2}\s*$/, '').replace(/[\s@–-]+$/, '').trim();

  let artist = null;
  let album = t;
  const idx = t.indexOf(' - ');
  if (idx > 0) {
    artist = t.slice(0, idx).trim();
    album = t.slice(idx + 3).trim();
  }
  return { artist, album, price, usAmazon };
}

async function fetchSubredditDeals(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status} (${feedUrl})`);
  const xml = await res.text();
  const subreddit = (feedUrl.match(/\/r\/([^/]+)/) || [, 'reddit'])[1];
  const deals = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  for (const block of entries) {
    const rawTitle = tag(block, 'title');
    if (!rawTitle) continue;
    const { artist, album, price, usAmazon } = parseTitle(rawTitle);
    if (!usAmazon) continue; // solo Amazon US

    const content = decodeEntities(tag(block, 'content') || '');
    const amazonUrl = pickAmazon(content);
    if (!amazonUrl) continue; // sin enlace de Amazon, lo saltamos

    const rid = (tag(block, 'id') || '').trim() || amazonUrl;
    const pub = tag(block, 'published');
    deals.push({
      id: `reddit-${rid.replace(/[^A-Za-z0-9]/g, '').slice(-14)}`,
      source: `r/${subreddit}`,
      createdAt: pub ? new Date(pub).toISOString() : new Date(0).toISOString(),
      text: decodeEntities(rawTitle),
      artist: artist || null,
      title: album || null,
      label: null,
      genres: [],
      price,
      wasPrice: null,
      discountPct: null,
      lowest: false,
      amazonUrl,
      knownArtist: false,
    });
  }
  return deals;
}

export async function getRedditDeals() {
  const feeds = feedList();
  const out = [];
  for (const url of feeds) {
    try {
      out.push(...(await fetchSubredditDeals(url)));
    } catch (err) {
      console.warn(`[reddit] ${err.message}`);
    }
  }
  return out;
}
