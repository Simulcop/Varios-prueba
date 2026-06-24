// Acceso a X en dos pasos, pensado para las restricciones actuales de X:
//   1) Descubrir los IDs de tweets recientes de un perfil (endpoint de timeline,
//      que tiene limite de peticiones -> reintentos con espera).
//   2) Hidratar cada tweet por su ID (endpoint tweet-result, fiable y sin limite
//      observado), que devuelve texto + enlaces de Amazon listos para parsear.
//
// Funciona desde una red con salida a x.com (tu Mac, un servidor, un runner de
// GitHub Actions). Desde redes que bloquean X, no.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15';

const TWEET_RESULT = (id) =>
  `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`;
const TIMELINE = (name) =>
  `https://syndication.twitter.com/srv/timeline-profile/screen-name/${name}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimitError extends Error {}

// Hidrata un tweet por ID -> objeto crudo listo para el parser (con entities).
export async function hydrateTweet(id) {
  const res = await fetch(TWEET_RESULT(id), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`tweet-result HTTP ${res.status} (id ${id})`);
  const j = await res.json();
  if (!j || !j.id_str) return null;
  return {
    id_str: j.id_str,
    screen_name: j.user?.screen_name,
    created_at: j.created_at,
    text: j.text || '',
    entities: j.entities || {},
  };
}

// Extrae IDs de tweets del HTML del timeline (blob __NEXT_DATA__).
function extractIdsFromHtml(html) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
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
  const ids = [];
  for (const e of entries) {
    const t = e?.content?.tweet;
    const id = t?.id_str || t?.id;
    if (id) ids.push(String(id));
  }
  return ids;
}

// Descubre los IDs recientes de un perfil. Reintenta ante "Rate limit exceeded".
export async function getRecentTweetIds(screenName, { retries = 3, baseDelay = 4000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(TIMELINE(screenName), {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(baseDelay * (attempt + 1));
      continue;
    }
    const body = await res.text();
    if (/rate limit exceeded/i.test(body) || res.status === 429) {
      if (attempt === retries) throw new RateLimitError(`@${screenName}: rate limit`);
      await sleep(baseDelay * Math.pow(2, attempt)); // 4s, 8s, 16s...
      continue;
    }
    const ids = extractIdsFromHtml(body);
    if (ids.length) return ids;
    // Cuerpo valido pero sin IDs: no insistimos.
    return [];
  }
  return [];
}

// Lee un perfil completo: IDs recientes -> hidrata cada uno (con pausa suave).
export async function fetchProfile(screenName, { max = 12, gap = 350 } = {}) {
  const ids = (await getRecentTweetIds(screenName)).slice(0, max);
  const tweets = [];
  for (const id of ids) {
    try {
      const tw = await hydrateTweet(id);
      if (tw) tweets.push(tw);
    } catch (err) {
      console.warn(`[twitter] no pude hidratar ${id}: ${err.message}`);
    }
    await sleep(gap);
  }
  return tweets;
}
