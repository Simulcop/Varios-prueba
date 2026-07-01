// Servidor HTTP sin dependencias: sirve la web (public/) y expone una API REST.
// Arranque: npm start  (o node server.mjs). Puerto por env PORT (def. 3000).
// La web NUNCA debe caer en datos de ejemplo: solo muestra el feed real que la
// Action de GitHub genera y commitea en data/deals.json.
process.env.LIVE_ONLY = process.env.LIVE_ONLY || '1';

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { getDeals, getWatchlistsConfig, saveWatchlistsConfig } from './src/store.mjs';
import { findMatches } from './src/filters.mjs';
import { refresh } from './src/refresh.mjs';
import { sendTestAlert, notifierStatus } from './src/notifier.mjs';
import { applyBan } from './src/ban.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No encontrado');
  }
}

// --- API -------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  // GET /api/state -> deals + watchlists + coincidencias actuales + estado notificador
  if (pathname === '/api/state' && req.method === 'GET') {
    const deals = await getDeals();
    const config = await getWatchlistsConfig();
    const matches = findMatches(deals, config);
    const matchIds = new Set(matches.map((m) => m.id));
    const reasonsById = Object.fromEntries(matches.map((m) => [m.id, m.reasons]));
    return sendJson(res, 200, {
      deals: deals.map((d) => ({ ...d, reasons: reasonsById[d.id] || [], matched: matchIds.has(d.id) })),
      config,
      notifier: notifierStatus(),
      counts: { total: deals.length, matched: matches.length },
    });
  }

  // PUT /api/watchlists -> guarda la config completa
  if (pathname === '/api/watchlists' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.watchlists)) {
      return sendJson(res, 400, { error: 'Formato invalido: falta watchlists[]' });
    }
    const saved = await saveWatchlistsConfig(body);
    return sendJson(res, 200, saved);
  }

  // POST /api/refresh -> lectura en vivo (SIN notificar; la web no manda WhatsApp)
  if (pathname === '/api/refresh' && req.method === 'POST') {
    const result = await refresh({ notify: false });
    return sendJson(res, 200, result.summary);
  }

  // POST /api/ban -> veta un artista (type=artist) o un LP (type=album) y lo
  // guarda de forma permanente (commit en GitHub) + local para efecto inmediato.
  if (pathname === '/api/ban' && req.method === 'POST') {
    const body = await readBody(req);
    const { type, value } = body || {};
    if (!['artist', 'album'].includes(type) || !value || !String(value).trim()) {
      return sendJson(res, 400, { error: 'Falta type (artist|album) o value' });
    }
    try {
      const result = await applyBan(type, String(value).trim());
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /api/test-alert -> envia una alerta de prueba por los canales configurados
  if (pathname === '/api/test-alert' && req.method === 'POST') {
    const result = await sendTestAlert();
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Ruta no encontrada' });
}

// Proteccion opcional por contraseña. Si SITE_PASSWORD esta definido, toda la
// web pide usuario/clave (HTTP Basic Auth). Si no esta definido, queda abierta.
function authorized(req) {
  const pass = process.env.SITE_PASSWORD;
  if (!pass) return true; // sin contraseña configurada -> abierto (no bloquea)
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Basic (.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const providedPass = decoded.slice(decoded.indexOf(':') + 1);
  return providedPass === pass;
}

const server = createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Vinyl Deal Radar", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return res.end('Necesitas contraseña para entrar.');
    }
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await serveStatic(req, res);
  } catch (err) {
    console.error('[server] Error:', err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🎵 Vinyl Deal Radar en http://localhost:${PORT}`);
  const ns = notifierStatus();
  console.log(`   WhatsApp: ${ns.whatsapp ? 'ON' : 'off (configura WHATSAPP_PHONE + CALLMEBOT_APIKEY)'}`);
});
