// Lee feeds RSS (p. ej. de RSS.app) que vigilan las cuentas de X y extrae los
// IDs de tweets. Es el paso de DESCUBRIMIENTO fiable: RSS.app hace el trabajo
// que X nos limita, y nosotros luego hidratamos cada tweet por su ID.
//
// No parseamos XML "de verdad": basta con buscar en el cuerpo del feed las URLs
// de tweets (x.com/usuario/status/ID), funcione el feed como RSS o como Atom.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';

const STATUS_RE =
  /https?:\/\/(?:www\.)?(?:x|twitter|mobile\.twitter)\.com\/[^/\s"'<>]+\/status\/(\d+)/gi;

// RSS.app da dos formatos: la pagina web (rss.app/r/feed/ID) y el feed XML
// (rss.app/feeds/ID.xml). Normalizamos a la del feed para leer siempre el XML.
function normalizeFeedUrl(u) {
  const m = u.match(/rss\.app\/r\/feed\/([A-Za-z0-9]+)/i);
  if (m) return `https://rss.app/feeds/${m[1]}.xml`;
  return u;
}

// Devuelve los IDs de tweets encontrados en un feed (los mas recientes primero).
export async function getFeedTweetIds(url, { max = 25 } = {}) {
  const res = await fetch(normalizeFeedUrl(url), {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status} (${url})`);
  const body = await res.text();
  const ids = [];
  let m;
  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(body)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.slice(0, max);
}

// Junta IDs de varios feeds, sin duplicados.
export async function getTweetIdsFromFeeds(urls, opts = {}) {
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    try {
      for (const id of await getFeedTweetIds(url, opts)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    } catch (err) {
      console.warn(`[rss] ${err.message}`);
    }
  }
  return out;
}
