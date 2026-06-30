// Ciclo completo de actualizacion: leer X -> parsear -> guardar deals nuevos
// -> casar con watchlists -> notificar lo nuevo -> marcar como visto.
import { fetchAllTweets } from './fetcher.mjs';
import { parseTweets } from './parser.mjs';
import { getSiteDeals } from './sitefeed.mjs';
import { enrichDeals } from './enrich.mjs';
import { upsertDeals, getWatchlistsConfig, getSeen, markSeen, getDeals } from './store.mjs';
import { findMatches } from './filters.mjs';
import { notifyDeals } from './notifier.mjs';

export async function refresh({ notify = true } = {}) {
  const { tweets, live, notes } = await fetchAllTweets();
  const tweetDeals = await parseTweets(tweets);

  // Fuentes web de deals (p. ej. bestvinyldeals.com): gratis, completas.
  let siteDeals = [];
  try {
    siteDeals = await getSiteDeals();
    if (siteDeals.length) (notes || []).push(`Web: ${siteDeals.length} deals`);
  } catch (err) {
    console.warn('[refresh] fuente web omitida:', err.message);
  }

  const parsed = [...tweetDeals, ...siteDeals];

  // Enriquecer genero/sello con base musical (desactivable con ENRICH=0).
  if (process.env.ENRICH !== '0') {
    try {
      await enrichDeals(parsed);
    } catch (err) {
      console.warn('[refresh] enriquecimiento omitido:', err.message);
    }
  }

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
    live: live || siteDeals.length > 0,
    notes: notes || [],
    fetched: tweets.length + siteDeals.length,
    parsed: parsed.length,
    newDeals: fresh.length,
    matched: matches.length,
    alerted: toAlert.length,
    totalDeals: (await getDeals()).length,
    at: new Date().toISOString(),
  };
  return { summary, fresh, matches, toAlert, notifications };
}
