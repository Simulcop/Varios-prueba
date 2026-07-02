// Cliente de Vinyl Deal Radar: carga estado, pinta el feed, filtra y gestiona watchlists.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let STATE = { deals: [], config: { watchlists: [], discovery: {} }, notifier: {} };
let DATA_LIVE = null; // ultimo estado de la busqueda en vivo (true/false)
const filters = { search: '', genre: '', label: '', maxPrice: Infinity, onlyMatches: true };

// --- Descartados (solo en este dispositivo) --------------------------------
// "Descartar" = ya lo lei, no me interesa: se oculta de la vista, pero NO es un
// ban. Se guarda en el navegador (localStorage). Con "Ver descartados" vuelven.
let showDismissed = false;
function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem('dismissedDeals') || '[]')); }
  catch { return new Set(); }
}
let DISMISSED = loadDismissed();
function saveDismissed() {
  localStorage.setItem('dismissedDeals', JSON.stringify([...DISMISSED]));
}
function isDismissed(id) { return DISMISSED.has(id); }
function dismissDeal(id) { DISMISSED.add(id); saveDismissed(); }
function restoreDeal(id) { DISMISSED.delete(id); saveDismissed(); }

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
  const anyDemo = DATA_LIVE === false || STATE.deals.some((d) => String(d.id).startsWith('demo-'));
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
  const passFilters = STATE.deals.filter(dealMatchesFilters);
  // Modo normal: oculta los descartados. Modo "ver descartados": muestra SOLO esos.
  const visible = passFilters.filter((d) =>
    showDismissed ? isDismissed(d.id) : !isDismissed(d.id)
  );
  container.innerHTML = '';
  $('#feedCount').textContent = `(${visible.length})`;
  $('#emptyState').classList.toggle('hidden', visible.length > 0);

  // Actualiza el boton de descartados (cuantos hay entre los que pasan filtros).
  const dismissedCount = passFilters.filter((d) => isDismissed(d.id)).length;
  const tgl = $('#showDismissed');
  if (tgl) {
    tgl.textContent = showDismissed
      ? '← Volver a los deals'
      : `🗂 Descartados (${dismissedCount})`;
    tgl.classList.toggle('hidden', dismissedCount === 0 && !showDismissed);
  }
  if (showDismissed && !visible.length) {
    $('#emptyState').textContent = 'No tienes deals descartados.';
    $('#emptyState').classList.remove('hidden');
  } else {
    $('#emptyState').textContent = 'No hay deals que coincidan con el filtro.';
  }

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

// --- Enlaces de Spotify (busqueda, sin cuenta ni API) ----------------------
function cleanForSearch(title) {
  return (title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\b\d+\s?lp\b|\bvinyl\b|\blp\b|\bexclusive\b|\bedition\b/gi, '')
    .replace(/\$\s*[\d,]+\.?\d*|\blowest\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const spSearch = (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;
function albumSpotifyUrl(d) {
  const q = [d.artist, cleanForSearch(d.title)].filter(Boolean).join(' ').trim();
  return q ? spSearch(q) : null;
}
function thisIsSpotifyUrl(d) {
  return d.artist ? spSearch(`This Is ${d.artist}`) : null;
}

function renderDealCard(d) {
  const dismissed = isDismissed(d.id);
  const card = el('div', 'deal' + (d.matched ? ' matched' : '') + (dismissed ? ' is-dismissed' : ''));

  const src = el('div', 'deal-source');
  src.appendChild(el('span', null, '@' + d.source));
  const right = el('span', 'src-right');
  right.appendChild(el('span', 'src-time', timeAgo(d.createdAt)));
  // Boton descartar / recuperar (ademas del swipe en el celular).
  if (dismissed) {
    const rec = el('button', 'btn-dismiss recover', '↩︎ Recuperar');
    rec.title = 'Volver a mostrar este deal';
    rec.addEventListener('click', () => { restoreDeal(d.id); renderFeed(); });
    right.appendChild(rec);
  } else {
    const dis = el('button', 'btn-dismiss', '✕');
    dis.title = 'Descartar (ya lo leí, no me interesa)';
    dis.addEventListener('click', () => doDismiss(d.id, card));
    right.appendChild(dis);
  }
  src.appendChild(right);
  card.appendChild(src);

  if (!dismissed) attachSwipe(card, d.id);

  // Portada del album (si la hay). Si la imagen falla, se oculta sin romper nada.
  if (d.cover) {
    const cover = el('div', 'deal-cover');
    const img = document.createElement('img');
    img.src = d.cover;
    img.alt = [d.artist, d.title].filter(Boolean).join(' – ') || 'Portada';
    img.loading = 'lazy';
    img.addEventListener('error', () => cover.remove());
    cover.appendChild(img);
    card.appendChild(cover);
  }

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

  if (d.bio) {
    const bio = el('div', 'deal-bio');
    bio.appendChild(el('span', null, d.bio));
    if (d.bioUrl) {
      const more = el('a', 'bio-more', ` ${d.bioSource || 'Wikipedia'} ↗`);
      more.href = d.bioUrl;
      more.target = '_blank';
      more.rel = 'noopener';
      bio.appendChild(more);
    }
    card.appendChild(bio);
  }

  if (d.reasons && d.reasons.length) {
    const reasons = el('div', 'reasons');
    d.reasons.forEach((r) =>
      reasons.appendChild(el('span', 'reason' + (r.type === 'discovery' ? ' discovery' : ''), '🔔 ' + r.name))
    );
    card.appendChild(reasons);
  }

  const spotifyUrl = albumSpotifyUrl(d);
  if (d.amazonUrl || spotifyUrl) {
    const buy = el('div', 'deal-buy');
    if (d.amazonUrl) {
      const isAmazon = /amzn\.|amazon\./i.test(d.amazonUrl);
      const a = el('a', null, isAmazon ? 'Ver en Amazon' : 'Ver deal →');
      a.href = d.amazonUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      buy.appendChild(a);
    }
    if (spotifyUrl) {
      const s = el('a', 'btn-spotify', '▶ Spotify');
      s.href = spotifyUrl;
      s.target = '_blank';
      s.rel = 'noopener';
      buy.appendChild(s);
      const thisIs = thisIsSpotifyUrl(d);
      if (thisIs) {
        const t = el('a', 'btn-spotify-soft', '♫ This Is…');
        t.href = thisIs;
        t.target = '_blank';
        t.rel = 'noopener';
        t.title = `Playlist "This Is ${d.artist}" en Spotify`;
        buy.appendChild(t);
      }
    }
    card.appendChild(buy);
  }

  // Fila de veto: oculta y bloquea para siempre la banda o este LP.
  const banRow = el('div', 'deal-ban');
  const albumVal = d.title || (d.text || '').slice(0, 60);
  if (d.artist) banRow.appendChild(makeBanBtn('artist', d.artist, `🚫 Banda`, `Vetar la banda "${d.artist}"`, card));
  if (albumVal) banRow.appendChild(makeBanBtn('album', albumVal, `🚫 LP`, `Vetar este LP: "${albumVal}"`, card));
  if (banRow.children.length) card.appendChild(banRow);

  return card;
}

// Descarta un deal con una pequena animacion de salida (funciona con swipe y boton).
function doDismiss(id, card) {
  dismissDeal(id);
  card.style.transition = 'transform .26s ease, opacity .26s ease';
  card.style.transform = 'translateX(-120%)';
  card.style.opacity = '0';
  toast('Descartado. Recupéralo en "Descartados".');
  setTimeout(renderFeed, 260);
}

// Swipe a la izquierda (en el celular) para descartar. Arrastra la tarjeta y,
// si pasa el umbral, la descarta; si no, vuelve a su sitio.
function attachSwipe(card, id) {
  let startX = 0, startY = 0, dx = 0, dragging = false;
  const THRESH = 90;
  card.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0; dragging = true;
    card.style.transition = 'none';
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const mx = t.clientX - startX;
    const my = t.clientY - startY;
    // Solo cuenta como swipe si es mas horizontal que vertical (no rompe el scroll).
    if (Math.abs(mx) < Math.abs(my)) return;
    dx = Math.min(0, mx); // solo hacia la izquierda
    card.style.transform = `translateX(${dx}px)`;
    card.style.opacity = String(1 + dx / 300);
  }, { passive: true });
  card.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = 'transform .2s, opacity .2s';
    if (dx <= -THRESH) {
      doDismiss(id, card);
    } else {
      card.style.transform = '';
      card.style.opacity = '';
    }
  });
}

function makeBanBtn(type, value, label, title, card) {
  const b = el('button', 'btn-ban', label);
  b.title = title;
  b.addEventListener('click', async () => {
    const what = type === 'artist' ? `la banda "${value}"` : `este LP:\n"${value}"`;
    if (!confirm(`¿Vetar ${what}?\n\nNo volverá a aparecer (web y WhatsApp).`)) return;
    b.disabled = true;
    b.textContent = '…';
    try {
      const res = await fetch('/api/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'error');
      card.style.transition = 'opacity .25s';
      card.style.opacity = '0';
      toast(j.committed ? '✅ Vetado y guardado' : '✅ Oculto aquí (sin token: no permanente)');
      setTimeout(loadState, 350);
    } catch (e) {
      b.disabled = false;
      b.textContent = label;
      toast('⚠️ No se pudo vetar: ' + e.message);
    }
  });
  return b;
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
  // El WhatsApp lo envia GitHub (no esta web), asi que aqui solo lo explicamos
  // para no mostrar una falsa alarma de "sin configurar".
  $('#notifierStatus').innerHTML =
    '📲 <strong>WhatsApp:</strong> lo envía GitHub automáticamente.<br>' +
    'Recibes un resumen cuando hay deals nuevos que pasan tus reglas.';
  const testBtn = $('#testAlert');
  if (testBtn) testBtn.style.display = 'none'; // la prueba solo aplica en el servidor de alertas
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

// Al abrir la web: muestra el feed real (data/deals.json) que la Action de
// GitHub genera y commitea. No buscamos en vivo desde aqui porque el servidor
// (Render) no puede acceder a Reddit; ese trabajo lo hace la Action.
async function init() {
  const om = $('#onlyMatches');
  if (om) om.checked = true;
  await loadState();
}
const _testBtn = $('#testAlert');
if (_testBtn) _testBtn.addEventListener('click', testAlert);

// Alterna entre el feed normal y la vista de "Descartados".
const _showDismissed = $('#showDismissed');
if (_showDismissed) {
  _showDismissed.addEventListener('click', () => {
    showDismissed = !showDismissed;
    renderFeed();
  });
}

// Panel plegable en el celular: el boton muestra/oculta filtros y alertas.
const _panelToggle = $('#panelToggle');
if (_panelToggle) {
  _panelToggle.addEventListener('click', () => {
    const sb = document.querySelector('.sidebar');
    const open = sb.classList.toggle('open');
    _panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    _panelToggle.textContent = open ? '⚙️ Filtros y alertas ▾' : '⚙️ Filtros y alertas ▸';
  });
}

init();
