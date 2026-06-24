// Orquesta la lectura de las 3 cuentas usando src/twitter.mjs (descubrir IDs +
// hidratar por tweet). Si X no es accesible o limita demasiado, cae a los datos
// reales de ejemplo (data/real-tweets-fixture.json) para que la app siga viva.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchProfile, RateLimitError } from './twitter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ACCOUNTS = ['bestvinyldeal', 'vinylonsale', 'vinyl_bargains'];

async function loadSampleTweets() {
  const raw = await readFile(join(__dirname, '..', 'data', 'real-tweets-fixture.json'), 'utf8');
  return JSON.parse(raw).tweets || [];
}

// Devuelve { tweets, live, notes }. live=true si vinieron de X; false si demo.
// Con LIVE_ONLY=1 (p.ej. en la GitHub Action) nunca cae a la demo: solo datos reales.
export async function fetchAllTweets({ allowSampleFallback = process.env.LIVE_ONLY !== '1' } = {}) {
  const collected = [];
  const notes = [];
  let liveCount = 0;

  for (const acc of ACCOUNTS) {
    try {
      const tweets = await fetchProfile(acc);
      if (tweets.length) {
        collected.push(...tweets);
        liveCount += tweets.length;
      } else {
        notes.push(`@${acc}: sin tweets`);
      }
    } catch (err) {
      if (err instanceof RateLimitError) notes.push(`@${acc}: limite de X (reintenta luego)`);
      else notes.push(`@${acc}: ${err.message}`);
      console.warn(`[fetcher] @${acc}: ${err.message}`);
    }
  }

  if (liveCount > 0) return { tweets: collected, live: true, notes };

  if (allowSampleFallback) {
    console.warn('[fetcher] X no accesible / limitado. Usando datos reales de ejemplo (demo).');
    return { tweets: await loadSampleTweets(), live: false, notes };
  }
  return { tweets: [], live: false, notes };
}
