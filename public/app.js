// Cliente de Vinyl Deal Radar: carga estado, pinta el feed, filtra y gestiona watchlists.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let STATE = { deals: [], config: { watchlists: [], discovery: {} }, notifier: {} };
const filters = { search: '', genre: '', label: '', maxPrice: Infinity, onlyMatches: true };

// --- Carga inicial ---------------------------------------------------------

async function loadState() {
  const res = await fetch('/api/state');
  STATE = await res.json();
  populateFilterOptions();
  renderWatchlists();
  renderNotifier();
  renderFeed();
  renderDataBadge();
}

function renderDataBadge() {
  const badge = $('#dataBadge');
  const anyDemo = STATE.deals.some((d) => String(d.id).startsWith('demo-'));
  if (!STATE.deals.length) {
    badge.textContent = 'sin datos';
    badge.className = 'badge badge-muted';
  } else if (anyDemo) {
    badge.textContent = '◷ datos de ejemplo';
    badge.className = 'badge badge-demo';
    badge.title = 'X no accesible desde el servidor: mostrando demo. Ejecuta el fetch donde haya acceso a X.';
  } else {
    badge.textContent = '● en vivo';
    badge.className = 'badge badge-live';
  }
}

// --- Opciones de filtro derivadas de los deals -----------------------------

function populateFilterOptions() {
  const genres = new Set();
  const labels = new Set();
  for (const d of STATE.deals) {
    (d.genres || []).forEach((g) => genres.add(g));
    if (d.label) labels.add(d.label);
  }
  fillSelect($('#genreFilter'), genres);
  fillSelect($('#labelFilter'), labels);
}

function fillSelect(sel, values) {
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';
  [...values].sort().forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = current;
}

// --- Feed ------------------------------------------------------------------

function dealMatchesFilters(d) {
  if (filters.onlyMatches && !d.matched) return false;
  if (filters.genre && !(d.genres || []).includes(filters.genre)) return false;
  if (filters.label && d.label !== filters.label) return false;
  if (filters.maxPrice !== Infinity && d.price != null && d.price > filters.maxPrice) return false;
  if (filters.search) {
    const hay = `${d.artist || ''} ${d.title || ''} ${d.label || ''} ${(d.genres || []).join(' ')} ${d.text || ''}`.toLowerCase();
    if (!hay.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

function renderFeed() {
  const container = $('#deals');
  const visible = STATE.deals.filter(dealMatchesFilters);
  container.innerHTML = '';
  $('#feedCount').textContent = `(${visible.length})`;
  $('#emptyState').classList.toggle('hidden', visible.length > 0);

  for (const d of visible) {
    container.appendChild(renderDealCard(d));
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderDealCard(d) {
  const card = el('div', 'deal' + (d.matched ? ' matched' : ''));

  const src = el('div', 'deal-source');
  src.appendChild(el('span', null, '@' + d.source));
  src.appendChild(el('span', null, timeAgo(d.createdAt)));
  card.appendChild(src);

  const title = el('div', 'deal-title');
  if (d.artist) {
    const a = el('span', 'deal-artist', d.artist);
    title.appendChild(a);
    title.appendChild(document.createTextNode(' — '));
  }
  title.appendChild(document.createTextNode(d.title || d.text.slice(0, 70)));
  card.appendChild(title);

  if (d.price != null) {
    const price = el('div', 'deal-price');
    const fmt = (p) => (Number.isInteger(p) ? `$${p}` : `$${p.toFixed(2)}`);
    price.appendChild(el('span', 'price-now', fmt(d.price)));
    if (d.wasPrice) price.appendChild(el('span', 'price-was', fmt(d.wasPrice)));
    if (d.discountPct != null) price.appendChild(el('span', 'price-disc', `-${d.discountPct}%`));
    if (d.lowest) price.appendChild(el('span', 'price-disc', '🔥 mínimo'));
    card.appendChild(price);
  }

  const tags = el('div', 'tags');
  (d.genres || []).forEach((g) => tags.appendChild(el('span', 'tag genre', g)));
  if (d.label) tags.appendChild(el('span', 'tag label', d.label));
  if (tags.children.length) card.appendChild(tags);

  if (d.reasons && d.reasons.length) {
    const reasons = el('div', 'reasons');
    d.reasons.forEach((r) =>
      reasons.appendChild(el('span', 'reason' + (r.type === 'discovery' ? ' discovery' : ''), '🔔 ' + r.name))
    );
    card.appendChild(reasons);
  }

  if (d.amazonUrl) {
    const buy = el('div', 'deal-buy');
    const isAmazon = /amzn\.|amazon\./i.test(d.amazonUrl);
    const a = el('a', null, isAmazon ? 'Ver en Amazon' : 'Ver deal →');
    a.href = d.amazonUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    buy.appendChild(a);
    card.appendChild(buy);
  }
  return card;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h`;
  return `${Math.round(diff / 86400)} d`;
}

// --- Watchlists ------------------------------------------------------------

function renderWatchlists() {
  const wrap = $('#watchlists');
  wrap.innerHTML = '';
  for (const wl of STATE.config.watchlists || []) {
    wrap.appendChild(renderWatchlist(wl));
  }
  // La de descubrimiento se gestiona como una watchlist especial al final.
  wrap.appendChild(renderDiscovery(STATE.config.discovery || {}));
}

function renderWatchlist(wl) {
  const node = $('#watchlistTpl').content.cloneNode(true);
  const root = node.querySelector('.watchlist');
  root.dataset.id = wl.id;
  node.querySelector('.wl-enabled').checked = wl.enabled !== false;
  node.querySelector('.wl-name').value = wl.name || '';
  node.querySelector('.wl-artists').value = (wl.artists || []).join(', ');
  node.querySelector('.wl-genres').value = (wl.genres || []).join(', ');
  node.querySelector('.wl-labels').value = (wl.labels || []).join(', ');
  node.querySelector('.wl-keywords').value = (wl.keywords || []).join(', ');
  node.querySelector('.wl-maxprice').value = wl.maxPrice ?? '';
  node.querySelector('.wl-discount').value = wl.minDiscountPct || '';
  node.querySelector('.wl-del').addEventListener('click', () => {
    root.remove();
  });
  return node;
}

function renderDiscovery(disc) {
  const root = el('div', 'watchlist');
  root.dataset.discovery = '1';
  root.innerHTML = `
    <div class="wl-row">
      <input class="wl-enabled" type="checkbox" ${disc.enabled !== false ? 'checked' : ''} />
      <input class="wl-name" type="text" value="🔎 Descubrimiento (artistas nuevos)" disabled />
    </div>
    <div class="wl-grid">
      <label>Géneros<input class="wl-genres" value="${(disc.genres || []).join(', ')}" /></label>
      <label>Sellos<input class="wl-labels" value="${(disc.labels || []).join(', ')}" /></label>
      <label>Precio máx<input class="wl-maxprice" type="number" min="0" value="${disc.maxPrice ?? ''}" /></label>
    </div>`;
  return root;
}

function splitList(v) {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectWatchlists() {
  const watchlists = [];
  let discovery = STATE.config.discovery || {};
  for (const root of $$('#watchlists .watchlist')) {
    if (root.dataset.discovery) {
      discovery = {
        ...discovery,
        enabled: root.querySelector('.wl-enabled').checked,
        genres: splitList(root.querySelector('.wl-genres').value),
        labels: splitList(root.querySelector('.wl-labels').value),
        maxPrice: numOrNull(root.querySelector('.wl-maxprice').value),
      };
      continue;
    }
    const name = root.querySelector('.wl-name').value.trim() || 'Sin nombre';
    watchlists.push({
      id: root.dataset.id || 'wl-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + watchlists.length,
      name,
      enabled: root.querySelector('.wl-enabled').checked,
      artists: splitList(root.querySelector('.wl-artists').value),
      genres: splitList(root.querySelector('.wl-genres').value),
      labels: splitList(root.querySelector('.wl-labels').value),
      keywords: splitList(root.querySelector('.wl-keywords').value),
      maxPrice: numOrNull(root.querySelector('.wl-maxprice').value),
      minDiscountPct: parseInt(root.querySelector('.wl-discount').value, 10) || 0,
    });
  }
  return { watchlists, discovery };
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function saveWatchlists() {
  const config = collectWatchlists();
  const res = await fetch('/api/watchlists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (res.ok) {
    toast('Alertas guardadas ✓');
    await loadState();
  } else {
    toast('Error al guardar');
  }
}

function addWatchlist() {
  const wrap = $('#watchlists');
  const tpl = renderWatchlist({ id: 'wl-' + Date.now(), name: '', enabled: true });
  // Insertar antes del bloque de descubrimiento.
  const disc = wrap.querySelector('[data-discovery]');
  wrap.insertBefore(tpl, disc);
}

// --- Notificador -----------------------------------------------------------

function renderNotifier() {
  const n = STATE.notifier || {};
  const parts = [];
  parts.push(`WhatsApp: ${n.whatsapp ? '✅ activo' : '⚠️ sin configurar'}`);
  if (n.webhook) parts.push('Webhook: ✅');
  $('#notifierStatus').innerHTML =
    parts.join(' · ') +
    (n.whatsapp ? '' : '<br>Define WHATSAPP_PHONE y CALLMEBOT_APIKEY en el servidor.');
}

// --- Acciones top ----------------------------------------------------------

async function refreshX() {
  const btn = $('#refreshBtn');
  btn.disabled = true;
  btn.textContent = '↻ Leyendo X…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const s = await res.json();
    toast(`Refrescado: ${s.newDeals} nuevos, ${s.alerted} alertas${s.live ? '' : ' (demo)'}`);
    await loadState();
  } catch {
    toast('Error al refrescar');
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refrescar X';
  }
}

async function testAlert() {
  const res = await fetch('/api/test-alert', { method: 'POST' });
  const r = await res.json();
  if (r.whatsapp?.ok) toast('Alerta de prueba enviada por WhatsApp ✓');
  else if (r.whatsapp?.skipped) toast('WhatsApp sin configurar (mira la consola del servidor)');
  else toast('No se pudo enviar (revisa apikey/telefono)');
}

// --- Toast ------------------------------------------------------------------

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// --- Eventos ----------------------------------------------------------------

$('#search').addEventListener('input', (e) => { filters.search = e.target.value; renderFeed(); });
$('#genreFilter').addEventListener('change', (e) => { filters.genre = e.target.value; renderFeed(); });
$('#labelFilter').addEventListener('change', (e) => { filters.label = e.target.value; renderFeed(); });
$('#priceFilter').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  filters.maxPrice = v >= 60 ? Infinity : v;
  $('#priceVal').textContent = v >= 60 ? '∞' : `$${v}`;
  renderFeed();
});
$('#onlyMatches').addEventListener('change', (e) => { filters.onlyMatches = e.target.checked; renderFeed(); });
$('#clearFilters').addEventListener('click', () => {
  Object.assign(filters, { search: '', genre: '', label: '', maxPrice: Infinity, onlyMatches: false });
  $('#search').value = ''; $('#genreFilter').value = ''; $('#labelFilter').value = '';
  $('#priceFilter').value = 60; $('#priceVal').textContent = '∞'; $('#onlyMatches').checked = false;
  renderFeed();
});
$('#saveWatchlists').addEventListener('click', saveWatchlists);
$('#addWatchlist').addEventListener('click', addWatchlist);
$('#refreshBtn').addEventListener('click', refreshX);

// Al abrir la web: busca en vivo y muestra lo que pasa tus reglas.
async function init() {
  const btn = $('#refreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Buscando deals…'; }
  const om = $('#onlyMatches');
  if (om) om.checked = true;
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch { /* si falla, mostramos lo que haya */ }
  if (btn) { btn.disabled = false; btn.textContent = '↻ Actualizar'; }
  await loadState();
}
$('#testAlert').addEventListener('click', testAlert);

init();
