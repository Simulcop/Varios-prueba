// Convierte un tweet en uno o varios "deals" estructurados y enriquecidos.
// Los tweets reales suelen traer VARIOS discos en un mismo post (cada uno con su
// enlace de Amazon) y el artista a veces viene como hashtag (#BeachHouse).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let CATALOG = null;
export async function loadCatalog() {
  if (CATALOG) return CATALOG;
  const raw = await readFile(join(__dirname, '..', 'data', 'catalog.json'), 'utf8');
  CATALOG = JSON.parse(raw);
  return CATALOG;
}

// --- Normalizacion de la entrada ------------------------------------------
// Acepta dos formatos: el de "tweet-result" de X (id_str/screen_name/entities)
// y el simple de los datos de ejemplo (id/source/createdAt/text).
function normalizeTweet(t) {
  const id = t.id || t.id_str;
  const source = t.source || t.screen_name || (t.user && t.user.screen_name) || 'x';
  const createdAt = t.createdAt || t.created_at || new Date(0).toISOString();
  const text = t.text || '';
  // urls de Amazon con sus posiciones (indices) dentro del texto, si vienen.
  const urls = ((t.entities && t.entities.urls) || [])
    .filter((u) => /amzn\.to|amzn\.eu|amazon\./i.test(u.expanded_url || ''))
    .map((u) => ({ url: u.expanded_url, indices: u.indices }))
    .sort((a, b) => a.indices[0] - b.indices[0]);
  return { id: `${source}-${id}`, source, createdAt, text, urls };
}

// --- Troceado en deals individuales ---------------------------------------
const AMAZON_RE = /\bhttps?:\/\/(?:amzn\.to|amzn\.eu|(?:www\.)?amazon\.[a-z.]+)\/\S+/gi;

// Divide un tweet en segmentos, uno por enlace de Amazon.
function splitSegments(tw) {
  const segments = [];
  if (tw.urls.length) {
    let cursor = 0;
    for (const u of tw.urls) {
      const seg = tw.text.slice(cursor, u.indices[0]);
      segments.push({ text: seg, amazonUrl: u.url });
      cursor = u.indices[1];
    }
    return segments;
  }
  // Sin entities: buscamos enlaces de Amazon directamente en el texto.
  let last = 0;
  let m;
  AMAZON_RE.lastIndex = 0;
  while ((m = AMAZON_RE.exec(tw.text)) !== null) {
    const seg = tw.text.slice(last, m.index);
    segments.push({ text: seg, amazonUrl: m[0].replace(/[)\].,]+$/, '') });
    last = AMAZON_RE.lastIndex;
  }
  if (!segments.length && /\$\s?\d/.test(tw.text)) {
    segments.push({ text: tw.text, amazonUrl: null });
  }
  return segments;
}

// --- Extraccion por segmento ----------------------------------------------
const PRICE_RE = /\$\s?(\d+(?:[.,]\d{1,2})?)/g;
const DISCOUNT_RE = /-\s?(\d{1,2})\s?%/;
const SEPARATORS = [' – ', ' — ', ' -- ', ' - ', ' | ', ' / '];

// "MichaelGiacchino" -> "Michael Giacchino" ; "MaxRoach" -> "Max Roach"
function splitCamel(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function extractPrices(text) {
  const nums = [];
  let m;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(text)) !== null) nums.push(parseFloat(m[1].replace(',', '.')));
  return nums;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function cleanSegment(text) {
  return decodeEntities(text)
    .replace(AMAZON_RE, '')
    .replace(/\bhttps?:?\/?\/?\S*/gi, '')
    .replace(/\(\s*lowest[^)]*\)|\blowest( price)?!?/gi, '')
    .replace(/\bprime day( deal)?\b|,?\s*\d+\s*left in stock/gi, '')
    .replace(/\(\s*was[^)]*\)|\bwas\b[^,.!]*/gi, '')
    .replace(/-\s?\d{1,2}\s?%/g, '')
    .replace(/\$\s?\d+(?:[.,]\d{1,2})?/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '')
    .trim();
}

function parseSegment(seg, tw, index, catalog) {
  const raw = seg.text;
  const prices = extractPrices(raw);
  const price = prices.length ? prices[0] : null;
  const lowest = /\(\s*lowest|\blowest\b/i.test(raw);

  const dm = raw.match(DISCOUNT_RE);
  const discountPct = dm ? parseInt(dm[1], 10) : null;

  let body = cleanSegment(raw);

  // Artista: si empieza por hashtag (#Artista) lo extraemos y desCamelizamos.
  let artist = null;
  let title = null;
  const hash = body.match(/^#(\w+)\b/);
  if (hash) {
    artist = splitCamel(hash[1]);
    body = body.slice(hash[0].length).trim();
    if (/^[-–—|/]/.test(body)) {
      // El cuerpo empieza por el separador artista/titulo (p.ej. "- Titulo").
      title = body.replace(/^[\s\-–—|/]+/, '').trim();
    } else {
      // Caso "#MaxRoach + 4 - Titulo": el "+ 4" es parte del artista.
      const sep = SEPARATORS.find((s) => body.includes(s));
      if (sep) {
        const idx = body.indexOf(sep);
        const pre = body.slice(0, idx).trim();
        if (pre) artist += ' ' + pre;
        title = body.slice(idx + sep.length).trim();
      } else {
        title = body.trim();
      }
    }
  } else {
    const sep = SEPARATORS.find((s) => body.includes(s));
    if (sep) {
      const idx = body.indexOf(sep);
      artist = body.slice(0, idx).trim();
      title = body.slice(idx + sep.length).trim();
    } else {
      title = body;
    }
  }

  if (!title) title = body || null;
  let artistKey = artist ? artist.toLowerCase().trim() : null;
  // "max roach + 4" -> "max roach" si la version corta esta en el catalogo.
  if (artistKey && !catalog.artists[artistKey]) {
    const alt = artistKey.replace(/\s*\+\s*\d+$/, '').trim();
    if (catalog.artists[alt]) artistKey = alt;
  }

  const label = detectLabel(raw, artistKey, catalog);
  const genres = detectGenres(raw, title, artistKey, catalog);
  const known = !!(artistKey && catalog.artists[artistKey]);

  return {
    id: `${tw.id}-${index}`,
    source: tw.source,
    createdAt: tw.createdAt,
    text: raw.trim(),
    artist: artist || null,
    title: title || null,
    label,
    genres,
    price,
    wasPrice: prices.length > 1 ? Math.max(...prices.slice(1)) : null,
    discountPct,
    lowest,
    amazonUrl: seg.amazonUrl,
    knownArtist: known,
  };
}

function detectLabel(text, artistKey, catalog) {
  for (const lbl of catalog.labelKeywords) {
    const re = new RegExp(`\\b${lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) return lbl;
  }
  if (artistKey && catalog.artists[artistKey]?.label) return catalog.artists[artistKey].label;
  return null;
}

function detectGenres(text, title, artistKey, catalog) {
  const found = new Set();
  if (artistKey && catalog.artists[artistKey]) {
    for (const g of catalog.artists[artistKey].genres) found.add(g);
  }
  const hay = `${text} ${title || ''}`.toLowerCase();
  for (const [genre, kws] of Object.entries(catalog.genreKeywords)) {
    if (kws.some((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay))) {
      found.add(genre);
    }
  }
  return [...found];
}

// --- API -------------------------------------------------------------------
export async function parseTweet(tweet) {
  const catalog = await loadCatalog();
  const tw = normalizeTweet(tweet);
  const segments = splitSegments(tw);
  return segments
    .map((seg, i) => parseSegment(seg, tw, i, catalog))
    .filter((d) => d.amazonUrl && (d.title || d.artist));
}

export async function parseTweets(tweets) {
  const out = [];
  for (const t of tweets) out.push(...(await parseTweet(t)));
  return out;
}
