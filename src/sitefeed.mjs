// Fuente "web de deals": lee el RSS de un sitio tipo bestvinyldeals.com, donde
// cada item es un deal (titulo "Artista - Album" + enlace a su pagina, que
// contiene el boton de Amazon). No trae precio en el feed, asi que usamos el
// enlace de la pagina como destino de compra y dejamos el precio sin fijar
// (mejor eso que un precio inventado). El genero/sello lo completa el
// enriquecimiento (Discogs/MusicBrainz) a partir de artista + album.
//
// Config: SITE_FEEDS (urls separadas por coma). Por defecto, bestvinyldeals.com.
// Para desactivar: SITE_FEEDS=none

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';

const DEFAULT_FEEDS = ['https://bestvinyldeals.com/feed/'];

const SEPARATORS = [' – ', ' — ', ' -- ', ' - ', ' | '];

function decodeEntities(s) {
  return (s || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function splitArtistAlbum(title) {
  for (const sep of SEPARATORS) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      return { artist: title.slice(0, idx).trim(), album: title.slice(idx + sep.length).trim() };
    }
  }
  return { artist: null, album: title };
}

function feedList() {
  const raw = process.env.SITE_FEEDS;
  // undefined o vacio (secret inexistente en la Action) -> usa el feed por defecto.
  if (raw === undefined || raw.trim() === '') return DEFAULT_FEEDS;
  if (raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function siteName(feedUrl) {
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

async function fetchFeedDeals(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Site RSS HTTP ${res.status} (${feedUrl})`);
  const xml = await res.text();
  const source = siteName(feedUrl);
  const deals = [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of items) {
    const title = tag(block, 'title');
    const link = tag(block, 'link');
    if (!title || !link) continue;
    const guid = tag(block, 'guid') || link;
    const pub = tag(block, 'pubDate');
    const { artist, album } = splitArtistAlbum(title);
    const idm = guid.match(/[?&]p=(\d+)/) || guid.match(/(\d{3,})/);
    const id = `${source}-${idm ? idm[1] : guid.replace(/\W+/g, '').slice(-16)}`;
    deals.push({
      id,
      source,
      createdAt: pub ? new Date(pub).toISOString() : new Date(0).toISOString(),
      text: title,
      artist: artist || null,
      title: album || null,
      label: null,
      genres: [],
      price: null,
      wasPrice: null,
      discountPct: null,
      lowest: false,
      amazonUrl: link, // pagina del deal (lleva al boton de Amazon)
      knownArtist: false,
    });
  }
  return deals;
}

// Devuelve los deals de todas las webs configuradas.
export async function getSiteDeals() {
  const feeds = feedList();
  const out = [];
  for (const url of feeds) {
    try {
      out.push(...(await fetchFeedDeals(url)));
    } catch (err) {
      console.warn(`[sitefeed] ${err.message}`);
    }
  }
  return out;
}
