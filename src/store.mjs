// Persistencia simple en ficheros JSON (sin dependencias).
// data/deals.json     -> feed enriquecido (generado)
// data/watchlists.json -> filtros del usuario (editable desde la web)
// data/seen.json      -> ids ya notificados (para no repetir alertas)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const paths = {
  deals: join(DATA_DIR, 'deals.json'),
  watchlists: join(DATA_DIR, 'watchlists.json'),
  watchlistsDefault: join(DATA_DIR, 'watchlists.default.json'),
  seen: join(DATA_DIR, 'seen.json'),
};

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

// --- Deals -----------------------------------------------------------------

export async function getDeals() {
  const data = await readJson(paths.deals, { deals: [] });
  return data.deals || [];
}

// Fusiona deals nuevos con los existentes, sin duplicar por id. Devuelve los que son nuevos.
export async function upsertDeals(newDeals) {
  const existing = await getDeals();
  const byId = new Map(existing.map((d) => [d.id, d]));
  const fresh = [];
  for (const d of newDeals) {
    if (!byId.has(d.id)) fresh.push(d);
    byId.set(d.id, { ...byId.get(d.id), ...d });
  }
  const merged = [...byId.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  await writeJson(paths.deals, { updatedAt: new Date().toISOString(), deals: merged });
  return fresh;
}

// --- Watchlists ------------------------------------------------------------

export async function getWatchlistsConfig() {
  if (!existsSync(paths.watchlists)) {
    const def = await readJson(paths.watchlistsDefault, { watchlists: [], discovery: {} });
    await writeJson(paths.watchlists, def);
    return def;
  }
  return readJson(paths.watchlists, { watchlists: [], discovery: {} });
}

export async function saveWatchlistsConfig(config) {
  await writeJson(paths.watchlists, config);
  return config;
}

// --- Seen (alertas ya enviadas) -------------------------------------------

export async function getSeen() {
  const data = await readJson(paths.seen, { ids: [] });
  return new Set(data.ids || []);
}

export async function markSeen(ids) {
  const seen = await getSeen();
  for (const id of ids) seen.add(id);
  await writeJson(paths.seen, { ids: [...seen] });
}
