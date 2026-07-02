// Portada del album desde la API de busqueda de iTunes (gratis, sin clave,
// imagenes fiables que cargan bien en el navegador). Se cachea en
// data/cover-cache.json. Devuelve una URL de imagen o null.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'cover-cache.json');
const UA = 'VinylDealRadar/0.2 (https://github.com/Simulcop/Varios-prueba)';
const COVER_V = 2; // sube la version para reintentar entradas viejas

let CACHE = null;
async function loadCache() {
  if (CACHE) return CACHE;
  try { CACHE = JSON.parse(await readFile(CACHE_PATH, 'utf8')); } catch { CACHE = {}; }
  return CACHE;
}
async function saveCache() {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(CACHE, null, 2), 'utf8');
}

function cleanTitle(title) {
  return (title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\b\d+\s?lp\b|\bvinyl\b|\blp\b|\bexclusive\b|\bedition\b|\bremaster(ed)?\b/gi, '')
    .replace(/@?\s*\$\s*[\d,]+\.?\d*|\bw\/\s*coupon\b|\bcoupon\b|\blowest\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Normaliza para comparar: minusculas, sin acentos ni puntuacion, sin "the ".
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchItunes(artist, title) {
  const cleanT = cleanTitle(title);
  const term = [artist, cleanT].filter(Boolean).join(' ').trim();
  if (!term) return null;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=6`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  const j = await res.json();
  const results = (j.results || []).filter((r) => r.artworkUrl100);
  if (!results.length) return null;

  const na = norm(artist), nt = norm(cleanT);
  // Puntua cada candidato: premia que coincida el artista y el album.
  function score(r) {
    const ra = norm(r.artistName), rc = norm(r.collectionName);
    let s = 0;
    if (na) {
      if (ra === na) s += 4;
      else if (ra.includes(na) || na.includes(ra)) s += 2;
      else s -= 5; // artista distinto: casi seguro es una portada equivocada
    }
    if (nt) {
      if (rc === nt) s += 4;
      else if (rc.includes(nt) || nt.includes(rc)) s += 2;
      else s -= 1;
    }
    return s;
  }
  let best = null, bestS = -Infinity;
  for (const r of results) {
    const sc = score(r);
    if (sc > bestS) { bestS = sc; best = r; }
  }
  // Si tenemos artista y ni el mejor lo respeta, mejor NO poner portada.
  if (na && bestS < 0) return null;
  if (!best) return null;
  // Sube la resolucion (iTunes sirve la miniatura 100x100; pedimos 400x400).
  return best.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/400x400bb.$1');
}

export async function getAlbumCover(artist, title) {
  if (!artist && !title) return null;
  const cache = await loadCache();
  const key = `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}`;
  const cached = cache[key];
  if (cached && cached.v === COVER_V) return cached.r;

  let result = null;
  try {
    result = await fetchItunes(artist, title);
  } catch (err) {
    console.warn(`[cover] ${artist} - ${title}: ${err.message}`);
  }
  cache[key] = { v: COVER_V, r: result };
  await saveCache();
  return result;
}
