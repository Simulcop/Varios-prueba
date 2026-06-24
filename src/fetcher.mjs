// Lee los ultimos posts de las cuentas de X usando el endpoint publico de
// "syndication" (el que alimenta los widgets embebidos de X). No requiere API key.
//
// IMPORTANTE: este endpoint solo funciona desde una red con salida a x.com.
// En entornos donde X esta bloqueado (p. ej. algunos CI o sandboxes) caemos
// automaticamente a los tweets de ejemplo de data/sample-deals.json para que
// la app siga siendo demostrable.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ACCOUNTS = ['bestvinyldeal', 'vinylonsale', 'vinyl_bargains'];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// El endpoint devuelve HTML con un blob JSON embebido (__NEXT_DATA__ style) o
// una estructura JSON segun la variante. Probamos la variante JSON de cdn.syndication.
function buildUrl(screenName) {
  return `https://syndication.twitter.com/srv/timeline-profile/screen-name/${screenName}`;
}

// Extrae tweets del HTML de syndication. El payload va dentro de un <script>
// con id __NEXT_DATA__ que contiene entries -> content -> tweet.
function extractTweetsFromHtml(html, source) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let json;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const entries =
    json?.props?.pageProps?.timeline?.entries ||
    json?.props?.pageProps?.contextProvider?.timeline?.entries ||
    [];
  const tweets = [];
  for (const e of entries) {
    const t = e?.content?.tweet;
    if (!t) continue;
    tweets.push({
      id: `${source}-${t.id_str || t.id}`,
      source,
      createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      text: t.full_text || t.text || '',
    });
  }
  return tweets;
}

async function fetchAccount(screenName) {
  const res = await fetch(buildUrl(screenName), {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} para @${screenName}`);
  const html = await res.text();
  return extractTweetsFromHtml(html, screenName);
}

async function loadSampleTweets() {
  const raw = await readFile(join(__dirname, '..', 'data', 'sample-deals.json'), 'utf8');
  return JSON.parse(raw).tweets || [];
}

// Devuelve { tweets, live } donde live=true si vinieron de X y false si son de ejemplo.
export async function fetchAllTweets({ allowSampleFallback = true } = {}) {
  const collected = [];
  let liveCount = 0;
  for (const acc of ACCOUNTS) {
    try {
      const tweets = await fetchAccount(acc);
      if (tweets.length) {
        collected.push(...tweets);
        liveCount += tweets.length;
      }
    } catch (err) {
      console.warn(`[fetcher] No pude leer @${acc}: ${err.message}`);
    }
  }

  if (liveCount > 0) {
    return { tweets: collected, live: true };
  }

  if (allowSampleFallback) {
    console.warn('[fetcher] X no accesible. Usando datos de ejemplo (modo demo).');
    return { tweets: await loadSampleTweets(), live: false };
  }
  return { tweets: [], live: false };
}
