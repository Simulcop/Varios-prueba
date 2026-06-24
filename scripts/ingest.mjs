#!/usr/bin/env node
// Ingesta MANUAL y fiable: le pasas URLs o IDs de tweets y los mete en el feed
// (hidratando por el endpoint tweet-result, que no tiene limite). Util cuando el
// timeline de X esta limitado pero tu quieres meter deals concretos ya.
//
// Uso:
//   node scripts/ingest.mjs https://x.com/bestvinyldeal/status/2069597877736034550 2069589686138331162
//   node scripts/ingest.mjs --file ids.txt     (un id o url por linea)
import { readFile } from 'node:fs/promises';
import { hydrateTweet } from '../src/twitter.mjs';
import { parseTweets } from '../src/parser.mjs';
import { upsertDeals, getWatchlistsConfig, getSeen, markSeen } from '../src/store.mjs';
import { findMatches } from '../src/filters.mjs';
import { notifyDeals } from '../src/notifier.mjs';

function extractId(s) {
  const m = String(s).match(/status\/(\d+)/) || String(s).match(/^(\d{6,})$/);
  return m ? m[1] : null;
}

async function collectArgs() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  let tokens = args.filter((a) => a !== '--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    tokens = tokens.filter((t) => t !== args[fileIdx + 1]);
    const content = await readFile(args[fileIdx + 1], 'utf8');
    tokens.push(...content.split(/\s+/).filter(Boolean));
  }
  return [...new Set(tokens.map(extractId).filter(Boolean))];
}

async function main() {
  const ids = await collectArgs();
  if (!ids.length) {
    console.error('Pasa URLs o IDs de tweets. Ej: node scripts/ingest.mjs https://x.com/.../status/123');
    process.exit(1);
  }
  console.log(`[ingest] Hidratando ${ids.length} tweet(s)...`);
  const raw = [];
  for (const id of ids) {
    try {
      const tw = await hydrateTweet(id);
      if (tw) raw.push(tw);
    } catch (err) {
      console.warn(`[ingest] ${id}: ${err.message}`);
    }
  }
  const deals = await parseTweets(raw);
  const fresh = await upsertDeals(deals);
  console.log(`[ingest] ${deals.length} deals parseados, ${fresh.length} nuevos.`);

  const config = await getWatchlistsConfig();
  const seen = await getSeen();
  const toAlert = findMatches(fresh, config).filter((m) => !seen.has(m.id));
  if (toAlert.length) {
    await notifyDeals(toAlert);
    await markSeen(toAlert.map((m) => m.id));
    console.log(`[ingest] ${toAlert.length} alertas enviadas.`);
  }
  console.log('[ingest] Listo. Abre la web (npm start) para verlos.');
}

main().catch((e) => {
  console.error('[ingest] Error:', e);
  process.exit(1);
});
