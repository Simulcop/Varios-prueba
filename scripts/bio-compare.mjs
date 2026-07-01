#!/usr/bin/env node
// One-off: compara la bio de unos artistas en Wikipedia / Discogs / Last.fm y
// escribe data/bio-compare.json (aplicando el mismo recorte que la app, ~300
// caracteres) para poder verlas lado a lado. No forma parte del pipeline.
import { writeFile } from 'node:fs/promises';

const UA = 'VinylDealRadar/0.2 (https://github.com/Simulcop/Varios-prueba)';
const ARTISTS = ['Aerosmith', 'Weezer', 'Rush', 'Death Cab for Cutie'];

function shorten(text, max = 300) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastDot = cut.lastIndexOf('. ');
  if (lastDot > 80) return cut.slice(0, lastDot + 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}
function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}
function stripDiscogs(s) {
  return (s || '')
    .replace(/\[url=[^\]]*\]([^\[]*)\[\/url\]/gi, '$1')
    .replace(/\[\/?[abil](=[^\]]*)?\]/gi, '')
    .replace(/\[\/?[^\]]*\]/g, '').replace(/\r/g, '').trim();
}

async function wikipedia(artist) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist)}?redirect=true`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return `(HTTP ${r.status})`;
    const j = await r.json();
    if (j.type === 'disambiguation' || !j.extract) return '(sin resultado)';
    return shorten(j.extract);
  } catch (e) { return `(error: ${e.message})`; }
}
async function discogs(artist) {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return '(sin token)';
  try {
    const s = await (await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(artist)}&type=artist&per_page=1&token=${token}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json();
    const hit = (s.results || [])[0];
    if (!hit?.id) return '(no encontrado)';
    const a = await (await fetch(`https://api.discogs.com/artists/${hit.id}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json();
    const p = stripDiscogs(a.profile);
    return p ? shorten(p) : '(sin perfil)';
  } catch (e) { return `(error: ${e.message})`; }
}
async function lastfm(artist) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return '(sin clave)';
  try {
    const d = await (await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${key}&format=json&autocorrect=1`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json();
    let sum = d.artist?.bio?.summary || '';
    sum = sum.replace(/<a\b[^>]*>\s*Read more on Last\.fm[\s\S]*$/i, '');
    const t = stripHtml(sum);
    return t ? shorten(t) : '(sin bio)';
  } catch (e) { return `(error: ${e.message})`; }
}

const out = [];
for (const a of ARTISTS) {
  out.push({ artist: a, wikipedia: await wikipedia(a), discogs: await discogs(a), lastfm: await lastfm(a) });
}
await writeFile('data/bio-compare.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
