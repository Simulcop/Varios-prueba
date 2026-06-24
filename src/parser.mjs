// Convierte texto de tweet en un "deal" estructurado y enriquecido:
// artista, album, sello, generos, precio actual/anterior, descuento y enlace Amazon.
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

// --- Helpers de extraccion -------------------------------------------------

const AMAZON_RE = /\bhttps?:\/\/(?:amzn\.to|amzn\.eu|(?:www\.)?amazon\.[a-z.]+)\/\S+/i;
const PRICE_RE = /\$\s?(\d+(?:[.,]\d{1,2})?)/g;
const DISCOUNT_RE = /-\s?(\d{1,2})\s?%/;

// Separadores tipicos entre artista y titulo en estas cuentas.
const ARTIST_TITLE_SEPARATORS = [' – ', ' — ', ' -- ', ' - ', ' | ', ' by '];

function extractAmazonUrl(text) {
  const m = text.match(AMAZON_RE);
  return m ? m[0].replace(/[)\].,]+$/, '') : null;
}

function extractPrices(text) {
  const nums = [];
  let m;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(text)) !== null) {
    nums.push(parseFloat(m[1].replace(',', '.')));
  }
  if (nums.length === 0) return { price: null, wasPrice: null };
  // El primer precio suele ser el actual; si hay un segundo (was/antes) es el anterior.
  const price = nums[0];
  const wasPrice = nums.length > 1 ? Math.max(...nums.slice(1)) : null;
  return { price, wasPrice };
}

function computeDiscount(text, price, wasPrice) {
  const m = text.match(DISCOUNT_RE);
  if (m) return parseInt(m[1], 10);
  if (price != null && wasPrice != null && wasPrice > 0) {
    return Math.round((1 - price / wasPrice) * 100);
  }
  return null;
}

// Quita la parte de URL, precios, descuentos y ruido para quedarnos con "Artista – Titulo".
function cleanTitleSegment(text) {
  return text
    .replace(AMAZON_RE, '')
    .replace(/\$\s?\d+(?:[.,]\d{1,2})?/g, '')
    .replace(/\(\s*was[^)]*\)/gi, '')
    .replace(/\bwas\b[^,.!]*/gi, '')
    .replace(/-\s?\d{1,2}\s?%/g, '')
    .replace(/\bnow\b|\blowest price[^,.!]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitArtistTitle(segment) {
  for (const sep of ARTIST_TITLE_SEPARATORS) {
    const idx = segment.indexOf(sep);
    if (idx > 0) {
      const artist = segment.slice(0, idx).trim();
      let title = segment.slice(idx + sep.length).trim();
      // Recorta descripciones tras el titulo (formato, genero suelto, etc.).
      title = title.replace(/\s*\(([^)]*(?:vinyl|lp|180g|2lp|3lp|box|edition|remaster|anniversary)[^)]*)\)/i, ' ($1)');
      return { artist, title };
    }
  }
  return { artist: null, title: segment };
}

// Detecta el sello: primero por catalogo de artista, luego por keyword en el texto.
function detectLabel(text, artistKey, catalog) {
  for (const lbl of catalog.labelKeywords) {
    const re = new RegExp(`\\b${lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) return lbl;
  }
  if (artistKey && catalog.artists[artistKey]?.label) {
    return catalog.artists[artistKey].label;
  }
  return null;
}

// Detecta generos: catalogo de artista + keywords de genero en el texto.
function detectGenres(text, artistKey, catalog) {
  const found = new Set();
  if (artistKey && catalog.artists[artistKey]) {
    for (const g of catalog.artists[artistKey].genres) found.add(g);
  }
  const lower = text.toLowerCase();
  for (const [genre, kws] of Object.entries(catalog.genreKeywords)) {
    if (kws.some((kw) => lower.includes(kw))) found.add(genre);
  }
  return [...found];
}

// --- API principal ---------------------------------------------------------

export async function parseTweet(tweet) {
  const catalog = await loadCatalog();
  const text = tweet.text || '';
  const amazonUrl = extractAmazonUrl(text);
  const { price, wasPrice } = extractPrices(text);
  const discountPct = computeDiscount(text, price, wasPrice);

  const segment = cleanTitleSegment(text);
  const { artist, title } = splitArtistTitle(segment);
  const artistKey = artist ? artist.toLowerCase().trim() : null;

  const label = detectLabel(text, artistKey, catalog);
  const genres = detectGenres(text, artistKey, catalog);
  const known = !!(artistKey && catalog.artists[artistKey]);

  return {
    id: tweet.id,
    source: tweet.source,
    createdAt: tweet.createdAt,
    text,
    artist,
    title: title || null,
    label,
    genres,
    price,
    wasPrice,
    discountPct,
    amazonUrl,
    knownArtist: known,
  };
}

export async function parseTweets(tweets) {
  const out = [];
  for (const t of tweets) out.push(await parseTweet(t));
  // Solo nos quedamos con los que tienen enlace de Amazon (son los deals reales).
  return out.filter((d) => d.amazonUrl);
}
