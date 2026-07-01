// Notificador desacoplado. Hoy: WhatsApp via CallMeBot (gratis para uso
// personal) y webhook generico. Manana puedes anadir Telegram, email, etc.
// sin tocar el resto del codigo.
//
// Config por variables de entorno:
//   WHATSAPP_PHONE      -> tu numero con prefijo, p.ej. 573001112233
//   CALLMEBOT_APIKEY    -> apikey que te da CallMeBot al activarlo
//   ALERT_WEBHOOK_URL   -> (opcional) cualquier webhook que reciba un POST JSON
//
// Como activar CallMeBot (una sola vez):
//   1) Anade el numero +34 644 51 95 23 a tus contactos de WhatsApp.
//   2) Envíale: "I allow callmebot to send me messages"
//   3) Te responde con tu apikey. Ponla en CALLMEBOT_APIKEY.

import { albumSpotifyUrl, thisIsSpotifyUrl } from './spotify.mjs';

function formatDealMessage(deal) {
  // OJO: CallMeBot interpreta "$" + digito como variable ($1, $2...) y lo borra,
  // comiendose el simbolo y el primer digito ($29.30 -> 9.3). Por eso el precio
  // se escribe como "29.30 USD" (sin $ pegado a un numero).
  const fmt = (p) => `${Number.isInteger(p) ? p : p.toFixed(2)} USD`;
  const price = deal.price != null ? fmt(deal.price) : 'ver precio en el enlace';
  const was = deal.wasPrice ? ` (antes ${fmt(deal.wasPrice)})` : '';
  const disc = deal.discountPct != null ? ` -${deal.discountPct}%` : '';
  const who = [deal.artist, deal.title].filter(Boolean).join(' – ') || deal.text.slice(0, 80);
  const tags = [deal.label, ...(deal.genres || [])].filter(Boolean).join(', ');
  const why = (deal.reasons || []).map((r) => r.name).join(' / ');
  const spotify = albumSpotifyUrl(deal);
  const thisIs = thisIsSpotifyUrl(deal);
  return (
    `🎵 ${who}\n` +
    `💿 ${price}${was}${disc}` +
    (tags ? `\n🏷️ ${tags}` : '') +
    (why ? `\n🔔 ${why}` : '') +
    (deal.amazonUrl ? `\n🛒 ${deal.amazonUrl}` : '') +
    (spotify ? `\n🎧 Spotify: ${spotify}` : '') +
    (thisIs ? `\n📻 This Is: ${thisIs}` : '')
  );
}

async function sendWhatsApp(text) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return { ok: false, skipped: true, channel: 'whatsapp' };
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return { ok: res.ok, channel: 'whatsapp', status: res.status };
  } catch (err) {
    return { ok: false, channel: 'whatsapp', error: err.message };
  }
}

async function sendWebhook(payload) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, channel: 'webhook' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, channel: 'webhook', status: res.status };
  } catch (err) {
    return { ok: false, channel: 'webhook', error: err.message };
  }
}

// Notifica una lista de deals (ya filtrados como nuevos+coincidentes).
export async function notifyDeals(deals) {
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    const text = formatDealMessage(deal);
    console.log('\n[alerta]\n' + text); // siempre log a consola
    const wa = await sendWhatsApp(text);
    const wh = await sendWebhook({ type: 'vinyl-deal', deal, text });
    results.push({ id: deal.id, whatsapp: wa, webhook: wh });
    // Pausa entre mensajes: CallMeBot bloquea si se envian muy seguidos.
    if (i < deals.length - 1 && wa.ok) await sleep(4000);
  }
  return results;
}

export async function sendTestAlert() {
  const text =
    '✅ Prueba de Vinyl Deal Radar\nSi recibes esto, las alertas de WhatsApp funcionan.';
  console.log('[alerta-prueba]\n' + text);
  const wa = await sendWhatsApp(text);
  const wh = await sendWebhook({ type: 'test', text });
  return { whatsapp: wa, webhook: wh };
}

export function notifierStatus() {
  return {
    whatsapp: !!(process.env.WHATSAPP_PHONE && process.env.CALLMEBOT_APIKEY),
    webhook: !!process.env.ALERT_WEBHOOK_URL,
  };
}
