// Veto (ban) desde la web: anade un artista o un LP a la lista de exclusion y
// lo guarda de forma PERMANENTE commiteando data/watchlists.default.json en
// GitHub (asi afecta tambien al WhatsApp y a todos los dispositivos). Ademas lo
// aplica en local (watchlists.json) para que el efecto sea inmediato.
//
// Necesita GITHUB_TOKEN (token fino con permiso de Contents: read/write en el
// repo). Sin token, el veto solo aplica en esta sesion (no permanente).
import { getWatchlistsConfig, saveWatchlistsConfig } from './store.mjs';

const REPO = process.env.GITHUB_REPO || 'Simulcop/Varios-prueba';
const FILE = 'data/watchlists.default.json';
const UA = 'vinyl-deal-radar';

function addUnique(arr, val) {
  const v = (val || '').trim();
  if (!v) return;
  if (!arr.some((x) => String(x).toLowerCase() === v.toLowerCase())) arr.push(v);
}

// Mete el veto en la config: banda -> artists + keywords; LP -> keywords.
function applyBanToConfig(config, type, value) {
  config.exclude = config.exclude || {};
  config.exclude.artists = config.exclude.artists || [];
  config.exclude.keywords = config.exclude.keywords || [];
  if (type === 'artist') {
    addUnique(config.exclude.artists, value);
    addUnique(config.exclude.keywords, value.toLowerCase());
  } else {
    // LP: la palabra clave (el titulo del album) casa en texto/titulo.
    addUnique(config.exclude.keywords, value.toLowerCase());
  }
  return config;
}

async function ghGetFile(token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub GET ${res.status}`);
  return res.json();
}

async function ghPutFile(token, content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha, branch: 'main' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function applyBan(type, value) {
  if (!['artist', 'album'].includes(type) || !value || !value.trim()) {
    throw new Error('Veto invalido');
  }
  const token = process.env.GITHUB_TOKEN;
  let committed = false;

  if (token) {
    // Fuente de verdad: el default mas reciente del repo (evita revertir cambios).
    const file = await ghGetFile(token);
    const config = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    applyBanToConfig(config, type, value);
    const body = JSON.stringify(config, null, 2) + '\n';
    const label = type === 'artist' ? `banda "${value}"` : `LP "${value}"`;
    await ghPutFile(token, body, file.sha, `Ban ${label} desde la web [skip ci]`);
    committed = true;
    // Aplica en local tambien para efecto inmediato en esta sesion.
    await saveWatchlistsConfig(config);
  } else {
    // Sin token: solo en esta sesion.
    const config = applyBanToConfig(await getWatchlistsConfig(), type, value);
    await saveWatchlistsConfig(config);
  }

  return { committed };
}
