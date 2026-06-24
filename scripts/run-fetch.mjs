#!/usr/bin/env node
// CLI para refrescar el feed una vez (o en bucle con --watch).
// Uso:
//   node scripts/run-fetch.mjs            -> una pasada
//   node scripts/run-fetch.mjs --watch    -> bucle (cada POLL_INTERVAL_MIN, def. 15)
import { refresh } from '../src/refresh.mjs';
import { notifierStatus } from '../src/notifier.mjs';

const watch = process.argv.includes('--watch');
const intervalMin = parseInt(process.env.POLL_INTERVAL_MIN || '15', 10);

async function once() {
  const { summary } = await refresh({ notify: true });
  console.log('[refresh]', JSON.stringify(summary));
}

async function main() {
  const ns = notifierStatus();
  console.log(
    `[run-fetch] Notificadores -> WhatsApp: ${ns.whatsapp ? 'ON' : 'off'}, Webhook: ${
      ns.webhook ? 'ON' : 'off'
    }`
  );
  await once();
  if (watch) {
    console.log(`[run-fetch] Modo watch: cada ${intervalMin} min.`);
    setInterval(once, intervalMin * 60 * 1000);
  }
}

main().catch((err) => {
  console.error('[run-fetch] Error:', err);
  process.exit(1);
});
