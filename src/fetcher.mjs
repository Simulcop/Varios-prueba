// Orquesta la lectura de las cuentas. Estrategia, de mas a menos fiable:
//   1) Feeds RSS (RSS.app) -> IDs de tweets -> hidratar por tweet-result.
//   2) Descubrimiento directo del timeline de X (limitado por X).
//   3) Datos reales de ejemplo (solo si se permite el fallback).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchProfile, hydrateTweet, RateLimitError } from './twitter.mjs';
import { getTweetIdsFromFeeds } from './rss.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ACCOUNTS = ['bestvinyldeal', 'vinylonsale', 'vinyl_bargains'];

// Feeds RSS desde env RSS_FEEDS (urls separadas por coma) o data/feeds.json.
async function loadFeeds() {
  if (process.env.RSS_FEEDS) {
    return process.env.RSS_FEEDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  try {
    const j = JSON.parse(await readFile(join(__dirname, '..', 'data', 'feeds.json'), 'utf8'));
    return (j.feeds || []).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadSampleTweets() {
  const raw = await readFile(join(__dirname, '..', 'data', 'real-tweets-fixture.json'), 'utf8');
  return JSON.parse(raw).tweets || [];
}

// Va 1: descubrir por RSS e hidratar por ID.
async function viaRss(feeds, notes) {
  const ids = await getTweetIdsFromFeeds(feeds);
  if (!ids.length) {
    notes.push('RSS: 0 tweets (revisa las URLs de los feeds)');
    return [];
  }
  const tweets = [];
  for (const id of ids) {
    try {
      const tw = await hydrateTweet(id);
      if (tw) tweets.push(tw);
    } catch (err) {
      console.warn(`[fetcher] no pude hidratar ${id}: ${err.message}`);
    }
  }
  notes.push(`RSS: ${ids.length} tweets descubiertos, ${tweets.length} leidos`);
  return tweets;
}

// Va 2: descubrir directamente del timeline de X (puede dar rate limit).
async function viaTimeline(notes) {
  const collected = [];
  for (const acc of ACCOUNTS) {
    try {
      const tweets = await fetchProfile(acc);
      if (tweets.length) collected.push(...tweets);
      else notes.push(`@${acc}: sin tweets`);
    } catch (err) {
      if (err instanceof RateLimitError) notes.push(`@${acc}: limite de X (reintenta luego)`);
      else notes.push(`@${acc}: ${err.message}`);
    }
  }
  return collected;
}

// Devuelve { tweets, live, notes }. Con LIVE_ONLY=1 nunca cae a la demo.
export async function fetchAllTweets({ allowSampleFallback = process.env.LIVE_ONLY !== '1' } = {}) {
  const notes = [];
  const feeds = await loadFeeds();

  let tweets = [];
  if (feeds.length) tweets = await viaRss(feeds, notes);
  if (!tweets.length) tweets = await viaTimeline(notes);

  if (tweets.length) return { tweets, live: true, notes };

  if (allowSampleFallback) {
    console.warn('[fetcher] Sin datos en vivo. Usando datos reales de ejemplo (demo).');
    return { tweets: await loadSampleTweets(), live: false, notes };
  }
  return { tweets: [], live: false, notes };
}
