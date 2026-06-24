// Ciclo completo de actualizacion: leer X -> parsear -> guardar deals nuevos
// -> casar con watchlists -> notificar lo nuevo -> marcar como visto.
import { fetchAllTweets } from './fetcher.mjs';
import { parseTweets } from './parser.mjs';
import { upsertDeals, getWatchlistsConfig, getSeen, markSeen, getDeals } from './store.mjs';
import { findMatches } from './filters.mjs';
import { notifyDeals } from './notifier.mjs';

export async function refresh({ notify = true } = {}) {
  const { tweets, live, notes } = await fetchAllTweets();
  const parsed = await parseTweets(tweets);
  const fresh = await upsertDeals(parsed);

  const config = await getWatchlistsConfig();

  // Coincidencias entre los deals NUEVOS de esta pasada.
  const matches = findMatches(fresh, config);

  // No repetir alertas ya enviadas.
  const seen = await getSeen();
  const toAlert = matches.filter((m) => !seen.has(m.id));

  let notifications = [];
  if (notify && toAlert.length) {
    notifications = await notifyDeals(toAlert);
    await markSeen(toAlert.map((m) => m.id));
  }

  const summary = {
    live,
    notes: notes || [],
    fetched: tweets.length,
    parsed: parsed.length,
    newDeals: fresh.length,
    matched: matches.length,
    alerted: toAlert.length,
    totalDeals: (await getDeals()).length,
    at: new Date().toISOString(),
  };
  return { summary, fresh, matches, toAlert, notifications };
}
