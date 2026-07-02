// Enriquece cada deal con genero/sello/ano consultando una base musical, porque
// los tweets casi nunca lo dicen. Dos proveedores:
//   - Discogs (preferido para vinilo): da genre + style + label en 1 consulta.
//     Necesita un token gratis en DISCOGS_TOKEN.
//   - MusicBrainz (respaldo): sin clave, pero los generos son mas pobres.
//
// Resultados cacheados en data/enrich-cache.json para no repetir consultas ni
// chocar con los limites de cada API.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getArtistBio } from './bio.mjs';
import { getAlbumCover } from './cover.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'enrich-cache.json');
const UA = 'VinylDealRadar/0.2 (https://github.com/Simulcop/Varios-prueba)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const keyOf = (artist, title) => `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}`.trim();

// Limpia el titulo de adornos (formato, edicion) para buscar mejor.
function cleanTitle(title) {
  return (title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\b\d+\s?lp\b|\bvinyl\b|\blp\b|\bbox set\b|\bremaster(ed)?\b|\banniversary\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- Discogs ---------------------------------------------------------------
async function fromDiscogs(artist, title, token) {
  const q = encodeURIComponent(`${artist || ''} ${cleanTitle(title)}`.trim());
  const url = `https://api.discogs.com/database/search?q=${q}&type=release&per_page=3&token=${token}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Discogs HTTP ${res.status}`);
  const data = await res.json();
  const r = (data.results || [])[0];
  if (!r) return null;
  const genres = [...new Set([...(r.genre || []), ...(r.style || [])])].slice(0, 4);
  const label = (r.label || []).find(Boolean) || null;
  return {
    genres,
    label,
    year: r.year || null,
    cover: r.cover_image || null,
    via: 'discogs',
  };
}

// --- MusicBrainz (sin clave) ----------------------------------------------
async function fromMusicBrainz(artist, title) {
  const query = `release:"${cleanTitle(title)}"${artist ? ` AND artist:"${artist}"` : ''}`;
  const sUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
  const sRes = await fetch(sUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!sRes.ok) throw new Error(`MusicBrainz HTTP ${sRes.status}`);
  const sData = await sRes.json();
  const rel = (sData.releases || [])[0];
  if (!rel) return null;
  const label = (rel['label-info'] || []).map((li) => li.label && li.label.name).find(Boolean) || null;
  const year = rel.date ? rel.date.slice(0, 4) : null;

  let genres = [];
  const rgId = rel['release-group'] && rel['release-group'].id;
  if (rgId) {
    await sleep(1100); // MusicBrainz: max ~1 req/seg
    try {
      const gUrl = `https://musicbrainz.org/ws/2/release-group/${rgId}?inc=genres&fmt=json`;
      const gRes = await fetch(gUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (gRes.ok) {
        const gData = await gRes.json();
        genres = (gData.genres || [])
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .slice(0, 4)
          .map((g) => cap(g.name));
      }
    } catch { /* sin generos, seguimos */ }
  }
  return { genres, label, year, cover: null, via: 'musicbrainz' };
}

// --- API -------------------------------------------------------------------
// Enriquece un deal in-place: completa label si falta y une generos.
export async function enrichDeal(deal) {
  if (!deal.title && !deal.artist) return deal;
  const token = process.env.DISCOGS_TOKEN;
  const cache = await loadCache();
  const k = keyOf(deal.artist, deal.title);

  let info = cache[k];
  if (info === undefined) {
    try {
      info = token
        ? await fromDiscogs(deal.artist, deal.title, token)
        : await fromMusicBrainz(deal.artist, deal.title);
    } catch (err) {
      console.warn(`[enrich] ${k}: ${err.message}`);
      info = null;
    }
    cache[k] = info; // cachea incluso null para no reintentar en cada pasada
    await saveCache();
  }

  if (info) {
    const merged = new Set([...(deal.genres || []), ...(info.genres || [])]);
    deal.genres = [...merged];
    if (!deal.label && info.label) deal.label = info.label;
    if (info.year) deal.year = info.year;
    if (info.cover) deal.cover = info.cover;
    deal.enrichedVia = info.via;
  }

  // Portada del album (iTunes). Si la encuentra, sobreescribe la de Discogs
  // (que a veces no carga en el navegador). Cacheada -> barata cada pasada.
  try {
    const cover = await getAlbumCover(deal.artist, deal.title);
    if (cover) deal.cover = cover;
  } catch (err) {
    console.warn(`[enrich] cover ${deal.artist}: ${err.message}`);
  }

  // Bio corta del artista (Wikipedia). getArtistBio esta cacheada, asi que
  // reevaluar cada pasada es barato y ademas corrige bios malas (p. ej. las
  // de "Various Artists", que ahora se descartan).
  if (deal.artist) {
    try {
      const bio = await getArtistBio(deal.artist);
      if (bio) {
        deal.bio = bio.text;
        deal.bioUrl = bio.url;
        deal.bioSource = bio.source || 'Wikipedia';
      } else {
        delete deal.bio;
        delete deal.bioUrl;
        delete deal.bioSource;
      }
    } catch (err) {
      console.warn(`[enrich] bio ${deal.artist}: ${err.message}`);
    }
  }
  return deal;
}

// Enriquece una lista. Solo pausa (respeta limites) cuando hay consulta real;
// los deals ya cacheados se resuelven al instante sin espera.
export async function enrichDeals(deals, { gap = 1100 } = {}) {
  const token = process.env.DISCOGS_TOKEN;
  const cache = await loadCache();
  for (const deal of deals) {
    const cached = cache[keyOf(deal.artist, deal.title)] !== undefined;
    await enrichDeal(deal);
    if (!cached) await sleep(token ? 300 : gap);
  }
  return deals;
}
