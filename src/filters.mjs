// Motor de coincidencias: dado un deal y la config de watchlists, decide si
// el deal interesa al usuario y por que (que watchlist lo dispara).

function norm(s) {
  return (s || '').toString().toLowerCase().trim();
}

function listIncludes(list, value) {
  if (!value) return false;
  const v = norm(value);
  return (list || []).some((x) => v.includes(norm(x)) || norm(x).includes(v));
}

function textMatchesKeyword(deal, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const hay = norm(`${deal.text} ${deal.artist} ${deal.title}`);
  return keywords.some((kw) => hay.includes(norm(kw)));
}

// Comprueba si un deal casa con UNA watchlist concreta.
// Logica: deben cumplirse las restricciones de precio/descuento (si las hay),
// y ademas casar con AL MENOS uno de los criterios listados (artista/sello/
// genero/keyword). Si la watchlist no lista ningun criterio positivo, casa
// cualquier deal que cumpla precio/descuento.
export function matchesWatchlist(deal, wl) {
  if (!wl.enabled) return false;

  if (wl.maxPrice != null && deal.price != null && deal.price > wl.maxPrice) return false;
  if (wl.minDiscountPct && (deal.discountPct == null || deal.discountPct < wl.minDiscountPct)) {
    return false;
  }

  const hasPositiveCriteria =
    (wl.artists && wl.artists.length) ||
    (wl.labels && wl.labels.length) ||
    (wl.genres && wl.genres.length) ||
    (wl.keywords && wl.keywords.length);

  if (!hasPositiveCriteria) return true; // solo filtra por precio/descuento

  const artistHit = listIncludes(wl.artists, deal.artist);
  const labelHit = listIncludes(wl.labels, deal.label);
  const genreHit = (wl.genres || []).some((g) => listIncludes(deal.genres, g));
  const kwHit = textMatchesKeyword(deal, wl.keywords);

  return artistHit || labelHit || genreHit || kwHit;
}

// Modo descubrimiento: artistas que NO conoces (knownArtist=false) pero que
// casan con tus generos/sellos preferidos. Para "encontrar cosas nuevas".
export function matchesDiscovery(deal, discovery) {
  if (!discovery || !discovery.enabled) return false;
  if (deal.knownArtist) return false; // descubrimiento = lo que aun no sigues
  if (discovery.maxPrice != null && deal.price != null && deal.price > discovery.maxPrice) {
    return false;
  }
  const genreHit = (discovery.genres || []).some((g) => listIncludes(deal.genres, g));
  const labelHit = listIncludes(discovery.labels, deal.label);
  return genreHit || labelHit;
}

// Lista negra: si un deal cae aqui, NO se notifica (aunque casara con algo).
// keepGenres = estilos que "rescatan" de la exclusion por GENERO (no del precio):
// p. ej. excluir "Country" pero dejar pasar "Country Rock"/"Alt-Country".
export function isExcluded(deal, ex, keepGenres) {
  if (!ex) return false;
  if (ex.maxPrice != null && deal.price != null && deal.price > ex.maxPrice) return true;
  if (ex.minPrice != null && deal.price != null && deal.price < ex.minPrice) return true;
  if (listIncludes(ex.artists, deal.artist)) return true;
  if (listIncludes(ex.labels, deal.label)) return true;
  if (listIncludes(ex.stores, deal.source)) return true;
  if (textMatchesKeyword(deal, ex.keywords)) return true;
  // Exclusion por genero, con rescate por estilo (keepGenres).
  const genreHit = (ex.genres || []).some((g) => listIncludes(deal.genres, g));
  if (genreHit) {
    // Rescate estricto: el deal debe TENER ese estilo (no al reves), para que
    // "Country" no se salve solo porque "Country Rock" lo contenga.
    const rescued = (keepGenres || []).some((g) =>
      (deal.genres || []).some((dg) => norm(dg).includes(norm(g)))
    );
    if (!rescued) return true;
  }
  return false;
}

// Evalua un deal contra toda la config. Devuelve los motivos (para mostrar y notificar).
export function evaluateDeal(deal, config) {
  // Artistas protegidos: siempre pasan, saltan cualquier exclusion.
  const protectedArtist = listIncludes(config.keepArtists, deal.artist);
  if (!protectedArtist && isExcluded(deal, config.exclude, config.keepGenres)) return []; // lista negra: fuera

  const reasons = [];
  // Modo "avisar de todo" (ir podando por exclusion).
  if (config.alertAll) reasons.push({ type: 'all', id: 'all', name: 'Deal US' });

  for (const wl of config.watchlists || []) {
    if (matchesWatchlist(deal, wl)) {
      reasons.push({ type: 'watchlist', id: wl.id, name: wl.name });
    }
  }
  if (matchesDiscovery(deal, config.discovery)) {
    reasons.push({ type: 'discovery', id: 'discovery', name: 'Descubrimiento' });
  }
  return reasons;
}

// Devuelve la lista de deals que disparan alguna alerta, con sus motivos adjuntos.
export function findMatches(deals, config) {
  const out = [];
  for (const deal of deals) {
    const reasons = evaluateDeal(deal, config);
    if (reasons.length) out.push({ ...deal, reasons });
  }
  return out;
}
