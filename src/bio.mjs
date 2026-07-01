// Biografia corta de cada artista desde Wikipedia (REST summary API): gratis,
// sin clave, texto limpio. AllMusic no ofrece API publica, asi que Wikipedia es
// la fuente fiable. Se cachea en data/bio-cache.json para no repetir consultas.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'bio-cache.json');
const UA = 'VinylDealRadar/0.2 (https://github.com/Simulcop/Varios-prueba)';

let CACHE = null;
async function loadCache() {
  if (CACHE) return CACHE;
  try {
    CACHE = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    CACHE = {};
  }
  return CACHE;
}
async function saveCache() {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(CACHE, null, 2), 'utf8');
}

// Recorta el resumen a 1-2 frases (max ~300 caracteres) para la tarjeta.
function shorten(text, max = 300) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  // Corta en el final de frase mas cercano por debajo del limite.
  const cut = clean.slice(0, max);
  const lastDot = cut.lastIndexOf('. ');
  if (lastDot > 80) return cut.slice(0, lastDot + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}

async function fetchSummary(pageTitle) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}?redirect=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  return res.json();
}

// Devuelve { text, url } o null. Si el nombre es ambiguo (pagina de
// desambiguacion), prueba variantes musicales "(band)", "(musician)", "(singer)".
// Nombres que no son un artista real (no tiene sentido buscarles bio).
const NOT_AN_ARTIST = /^(various(\s+artists)?|va|soundtrack|original\s+(motion\s+picture\s+)?soundtrack|ost|cast\s+recording|original\s+cast)$/i;

export async function getArtistBio(artist) {
  if (!artist || NOT_AN_ARTIST.test(artist.trim())) return null;
  const cache = await loadCache();
  const key = artist.toLowerCase();
  if (cache[key] !== undefined) return cache[key];

  let result = null;
  const candidates = [artist, `${artist} (band)`, `${artist} (musician)`, `${artist} (singer)`];
  try {
    // 1) Nombre tal cual: si es articulo normal, lo usamos.
    const first = await fetchSummary(artist);
    if (first && first.type !== 'disambiguation' && first.extract) {
      result = { text: shorten(first.extract), url: first.content_urls?.desktop?.page || null };
    } else {
      // 2) Ambiguo o inexistente: probamos variantes musicales.
      for (const c of candidates.slice(1)) {
        const s = await fetchSummary(c);
        if (s && s.type !== 'disambiguation' && s.extract) {
          result = { text: shorten(s.extract), url: s.content_urls?.desktop?.page || null };
          break;
        }
      }
    }
  } catch (err) {
    console.warn(`[bio] ${artist}: ${err.message}`);
    result = null;
  }

  cache[key] = result; // cachea incluso null para no reintentar cada pasada
  await saveCache();
  return result;
}
