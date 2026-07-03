// Lee deals de subreddits de ofertas (por defecto r/VinylDeals): RSS Atom nativo,
// gratis y permanente, con mucho volumen. Cada post trae en el TITULO la tienda,
// el artista - album y el precio; y en el CUERPO el enlace de Amazon (US, /dp/).
//
// Filtramos a Amazon US y extraemos artista/album/precio/enlace. El genero/sello
// los completa el enriquecimiento (Discogs/MusicBrainz).
//
// Config: REDDIT_FEEDS (urls .rss separadas por coma). "none" lo desactiva.

const UA = 'vinyl-deal-radar/1.0 (+https://github.com/Simulcop/Varios-prueba)';
// Pedimos hasta 100 por lectura (Reddit por defecto solo da 25) y sumamos el
// "top de la semana" para no perder los deals populares entre lecturas.
const DEFAULT_FEEDS = [
  'https://www.reddit.com/r/VinylDeals/new/.rss?limit=100',
  'https://www.reddit.com/r/VinylDeals/top/.rss?t=week&limit=100',
];

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

// Elige el enlace del deal del cuerpo: preferimos amazon.com/dp; si no, el
// primer enlace que NO sea de reddit (la tienda: target, walmart, etc.).
function pickDealUrl(html) {
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => /^https?:\/\//i.test(u) && !/reddit\.com/i.test(u));
  if (!hrefs.length) return null;
  const dp = hrefs.find((u) => /amazon\.com\/(?:[^"\s]*\/)?dp\/[A-Z0-9]+/i.test(u));
  return (dp || hrefs[0]).replace(/[).,]+$/, '');
}

// Marcadores de tiendas/regiones NO estadounidenses (para excluirlas).
const NON_US = /\b(uk|u\.k\.?|canada|eu|europe|germany|deutschland|france|australia|japan|mexico|international|intl|de|fr|au|jp|nz|ca)\b/i;
// Tags que NO son deals (discusiones, avisos, busquedas...).
const NON_DEAL = /\b(discussion|psa|meta|question|help|megathread|weekly|daily|thread|announcement|\bmod\b|found|iso|wtb|looking|review)\b/i;

// De un titulo "(Store) [Regional] Artista - Album @ $19.99" saca los campos.
function parseTitle(rawTitle) {
  let t = decodeEntities(rawTitle).trim();

  // Tags iniciales entre [] o (): tienda y region.
  const lead = (t.match(/^\s*(?:[[(][^\])]*[\])]\s*)+/) || [''])[0];
  // US = cualquier tienda que NO tenga marcador de otro pais.
  const isUS = !NON_US.test(lead);
  // Nombre de la tienda (primer tag, quitando palabras de promocion).
  const firstTag = ((lead.match(/[[(]\s*([^\])]+?)\s*[\])]/) || [, ''])[1] || '')
    .replace(/\b(regional|coupon|deal|sale)\b/gi, '')
    .trim();
  // Es un deal real solo si trae etiqueta de tienda y no es discusion/basura.
  const hasStore = !!firstTag && !NON_DEAL.test(lead);

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
  return { artist, album, price, isUS, hasStore, store: firstTag };
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
    const { artist, album, price, isUS, hasStore, store } = parseTitle(rawTitle);
    if (!isUS || !hasStore) continue; // solo US y con etiqueta de tienda real

    const content = decodeEntities(tag(block, 'content') || '');
    const dealUrl = pickDealUrl(content);
    if (!dealUrl) continue; // sin enlace de tienda, lo saltamos

    const rid = (tag(block, 'id') || '').trim() || dealUrl;
    const pub = tag(block, 'published');
    deals.push({
      id: `reddit-${rid.replace(/[^A-Za-z0-9]/g, '').slice(-14)}`,
      source: store || `r/${subreddit}`,
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
      amazonUrl: dealUrl, // enlace a la tienda (Amazon u otra US)
      knownArtist: false,
    });
  }
  return deals;
}

// --- Acceso por API oficial (OAuth) -----------------------------------------
// Funciona desde IPs de servidores (Render, etc.) donde el RSS publico da 403.
// Necesita REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET (app tipo "script" en Reddit).

function subredditList() {
  return feedList().map((u) => (u.match(/\/r\/([^/]+)/) || [, 'VinylDeals'])[1]);
}

async function getAppToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth token HTTP ${res.status}`);
  const j = await res.json();
  return j.access_token || null;
}

async function fetchSubredditOAuth(subreddit, token) {
  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/new?limit=25&raw_json=1`, {
    headers: { Authorization: `bearer ${token}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth HTTP ${res.status} (r/${subreddit})`);
  const j = await res.json();
  const deals = [];
  for (const child of j.data?.children || []) {
    const p = child.data;
    if (!p || !p.title) continue;
    const { artist, album, price, isUS, hasStore, store } = parseTitle(p.title);
    if (!isUS || !hasStore) continue;
    // Enlace del deal: la url del post o los enlaces del cuerpo (prefiere amazon.com/dp).
    const html = (p.url ? `href="${p.url}" ` : '') + decodeEntities(p.selftext_html || '');
    const dealUrl = pickDealUrl(html);
    if (!dealUrl) continue;
    deals.push({
      id: `reddit-${p.id}`,
      source: store || `r/${subreddit}`,
      createdAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : new Date(0).toISOString(),
      text: p.title,
      artist: artist || null,
      title: album || null,
      label: null,
      genres: [],
      price,
      wasPrice: null,
      discountPct: null,
      lowest: false,
      amazonUrl: dealUrl,
      knownArtist: false,
    });
  }
  return deals;
}

export async function getRedditDeals() {
  // 1) API oficial (funciona desde servidores) si hay credenciales.
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    try {
      const token = await getAppToken();
      if (token) {
        const out = [];
        for (const sub of subredditList()) {
          try {
            out.push(...(await fetchSubredditOAuth(sub, token)));
          } catch (e) {
            console.warn(`[reddit-oauth] ${e.message}`);
          }
        }
        if (out.length) return out;
      }
    } catch (e) {
      console.warn(`[reddit-oauth] ${e.message}`);
    }
  }
  // 2) Fallback: RSS publico (funciona desde IPs residenciales / a veces GitHub).
  const out = [];
  for (const url of feedList()) {
    try {
      out.push(...(await fetchSubredditDeals(url)));
    } catch (err) {
      console.warn(`[reddit] ${err.message}`);
    }
  }
  return out;
}
