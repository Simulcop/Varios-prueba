// Favoritos ("Tus joyas"): al dar corazón se guarda una FOTO del deal, de forma
// PERMANENTE, commiteando data/favorites.json en GitHub (sincroniza entre
// dispositivos y sobrevive aunque el deal desaparezca del feed). Ademas se
// aplica en local para efecto inmediato. Necesita GITHUB_TOKEN.
import { getFavorites, saveFavorites } from './store.mjs';

const REPO = process.env.GITHUB_REPO || 'Simulcop/Varios-prueba';
const FILE = 'data/favorites.json';
const UA = 'vinyl-deal-radar';

// Campos que guardamos de cada deal (foto para la joya).
function snapshot(deal) {
  return {
    id: deal.id,
    artist: deal.artist || null,
    title: deal.title || null,
    text: deal.text || null,
    createdAt: deal.createdAt || null,
    genres: deal.genres || [],
    label: deal.label || null,
    price: deal.price ?? null,
    cover: deal.cover || null,
    amazonUrl: deal.amazonUrl || null,
    source: deal.source || null,
    savedAt: new Date().toISOString(),
  };
}

// Aplica el favorito sobre una lista de items (toggle por defecto).
function applyToItems(items, deal, action) {
  const has = items.some((it) => it.id === deal.id);
  let favorited;
  if (action === 'add' || (action === 'toggle' && !has)) {
    if (!has) items.unshift(snapshot(deal));
    favorited = true;
  } else {
    // remove
    const i = items.findIndex((it) => it.id === deal.id);
    if (i >= 0) items.splice(i, 1);
    favorited = false;
  }
  return { items, favorited };
}

async function ghGetFile(token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return { content: null, sha: null }; // aun no existe
  if (!res.ok) throw new Error(`GitHub GET ${res.status}`);
  return res.json();
}

async function ghPutFile(token, content, sha, message) {
  const body = { message, content: Buffer.from(content, 'utf8').toString('base64'), branch: 'main' };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function applyFavorite(deal, action = 'toggle') {
  if (!deal || !deal.id) throw new Error('Deal invalido');
  const token = process.env.GITHUB_TOKEN;
  let committed = false;
  let favorited = false;

  if (token) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = await ghGetFile(token);
      const current = file.content
        ? JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
        : { items: [] };
      const res = applyToItems(current.items || [], deal, action);
      favorited = res.favorited;
      const payload = JSON.stringify({ updatedAt: new Date().toISOString(), items: res.items }, null, 2) + '\n';
      const who = deal.artist ? `${deal.artist} – ${deal.title || ''}`.trim() : (deal.title || deal.id);
      const msg = `${favorited ? 'Joya' : 'Quitar joya'}: ${who} [skip ci]`;
      try {
        await ghPutFile(token, payload, file.sha, msg);
        committed = true;
        await saveFavorites({ items: res.items }); // efecto inmediato en local
        break;
      } catch (e) {
        if (/\b409\b/.test(e.message) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  } else {
    const current = await getFavorites();
    const res = applyToItems(current.items, deal, action);
    favorited = res.favorited;
    await saveFavorites({ items: res.items });
  }

  return { committed, favorited };
}
