// Enlaces de Spotify para cada deal. Por defecto usa enlaces de BUSQUEDA de
// Spotify (no requieren cuenta ni API): abren Spotify directamente en el
// resultado del disco o de la playlist "This Is {artista}".
//
// Mejora futura: con SPOTIFY_CLIENT_ID/SECRET se podrian resolver los enlaces
// exactos via la API. De momento, la busqueda es fiable y sin configuracion.

function cleanForSearch(title) {
  return (title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '') // quita [2 LP], (Vinyl), etc.
    .replace(/\b\d+\s?lp\b|\bvinyl\b|\blp\b|\bexclusive\b|\bedition\b/gi, '')
    .replace(/@?\s*\$\s*[\d,]+\.?\d*|\bw\/\s*coupon\b|\bcoupon\b|\blowest\b/gi, '') // precio/cupon
    .replace(/[@–-]+\s*$/, '') // separadores sueltos al final
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const sp = (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;

// Enlace para escuchar el disco (busqueda artista + titulo).
export function albumSpotifyUrl(deal) {
  const q = [deal.artist, cleanForSearch(deal.title)].filter(Boolean).join(' ').trim();
  return q ? sp(q) : null;
}

// Enlace a la playlist editorial "This Is {artista}" (via busqueda).
export function thisIsSpotifyUrl(deal) {
  if (!deal.artist) return null;
  return sp(`This Is ${deal.artist}`);
}
