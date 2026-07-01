// Ciclo completo de actualizacion: leer X -> parsear -> guardar deals nuevos
// -> casar con watchlists -> notificar lo nuevo -> marcar como visto.
import { fetchAllTweets } from './fetcher.mjs';
import { parseTweets } from './parser.mjs';
import { getSiteDeals } from './sitefeed.mjs';
import { getRedditDeals } from './redditdeals.mjs';
import { enrichDeals } from './enrich.mjs';
import { saveDeals, getWatchlistsConfig, getSeen, markSeen, getDeals } from './store.mjs';
import { findMatches } from './filters.mjs';
import { notifyDeals, notifyDigest } from './notifier.mjs';

export async function refresh({ notify = true } = {}) {
  const { tweets, live, notes } = await fetchAllTweets();
  const tweetDeals = await parseTweets(tweets);

  // Fuentes web de deals (p. ej. bestvinyldeals.com): off por defecto.
  let siteDeals = [];
  try {
    siteDeals = await getSiteDeals();
    if (siteDeals.length) (notes || []).push(`Web: ${siteDeals.length} deals`);
  } catch (err) {
    console.warn('[refresh] fuente web omitida:', err.message);
  }

  // Reddit (r/VinylDeals): gratis, permanente, US, con precio. Fuente principal.
  let redditDeals = [];
  try {
    redditDeals = await getRedditDeals();
    if (redditDeals.length) (notes || []).push(`Reddit: ${redditDeals.length} deals`);
  } catch (err) {
    console.warn('[refresh] fuente reddit omitida:', err.message);
  }

  const parsed = [...tweetDeals, ...siteDeals, ...redditDeals];

  // Fusiona lo nuevo con lo ya guardado (por id) y anota cuales son nuevos.
  const existing = await getDeals();
  const byId = new Map(existing.map((d) => [d.id, d]));
  const freshIds = [];
  for (const d of parsed) {
    if (!byId.has(d.id)) freshIds.push(d.id);
    byId.set(d.id, { ...byId.get(d.id), ...d });
  }
  const all = [...byId.values()];

  // Enriquecer TODO el feed (genero/sello/bio). Con cache es barato y ademas
  // corrige datos obsoletos de deals viejos (bios malas, etc.). ENRICH=0 lo salta.
  if (process.env.ENRICH !== '0') {
    try {
      await enrichDeals(all);
    } catch (err) {
      console.warn('[refresh] enriquecimiento omitido:', err.message);
    }
  }

  await saveDeals(all);
  const fresh = all.filter((d) => freshIds.includes(d.id));

  const config = await getWatchlistsConfig();

  // Coincidencias entre los deals NUEVOS de esta pasada.
  const matches = findMatches(fresh, config);

  // No repetir alertas ya enviadas.
  const seen = await getSeen();
  const toAlert = matches.filter((m) => !seen.has(m.id));

  let notifications = [];
  if (notify && toAlert.length) {
    // DIGEST=1 -> un solo mensaje-resumen (fiable con CallMeBot). Si no, uno por deal.
    notifications =
      process.env.DIGEST === '1' ? await notifyDigest(toAlert) : await notifyDeals(toAlert);
    await markSeen(toAlert.map((m) => m.id));
  }

  const summary = {
    live: live || siteDeals.length > 0 || redditDeals.length > 0,
    notes: notes || [],
    fetched: tweets.length + siteDeals.length + redditDeals.length,
    parsed: parsed.length,
    newDeals: fresh.length,
    matched: matches.length,
    alerted: toAlert.length,
    totalDeals: (await getDeals()).length,
    at: new Date().toISOString(),
  };
  return { summary, fresh, matches, toAlert, notifications };
}
