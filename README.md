# 💿 Vinyl Deal Radar

Agrega las promociones de **vinilos en Amazon** que publican estas cuentas de X,
las enriquece (artista, álbum, sello, género, precio y descuento) y te avisa por
**WhatsApp** cuando aparece algo que casa con tus filtros. Incluye un modo
**Descubrimiento** para encontrar artistas que aún no sigues pero que encajan con
tus gustos.

Cuentas seguidas:
- [@bestvinyldeal](https://x.com/bestvinyldeal)
- [@vinylonsale](https://x.com/vinylonsale)
- [@vinyl_bargains](https://x.com/vinyl_bargains)

---

## ⚠️ Importante sobre la lectura de X

X cerró casi todo su acceso gratuito. Esta app lo lee **sin API key** en dos pasos
(`src/twitter.mjs`):

1. **Descubrir** los IDs de tweets recientes de cada perfil (endpoint de
   *timeline* de syndication). Este paso **tiene límite de peticiones** de X, así
   que se reintenta con esperas crecientes.
2. **Hidratar** cada tweet por su ID (endpoint `tweet-result`), que es **fiable y
   sin límite observado** y devuelve texto + enlaces de Amazon.

Esto funciona desde una red con salida a `x.com` (tu Mac, un servidor, un runner
de GitHub Actions). Desde redes que bloquean X, no.

- ✅ Si consigue datos reales, el feed se marca **«en vivo»**.
- ⚠️ Si el timeline está limitado o X no es accesible, cae a **datos reales de
  ejemplo** (`data/real-tweets-fixture.json`) y lo marca como **«datos de
  ejemplo»**.

### Puente RSS (recomendado para que sea fiable)
X limita el paso de **descubrir** tweets nuevos incluso desde GitHub. La solución
estable es un puente RSS que vigila las cuentas por nosotros; la app lee ese feed
(sin límite), saca los IDs e hidrata cada tweet por `tweet-result`.

Cómo montarlo:
1. Crea una cuenta gratis en [rss.app](https://rss.app).
2. Genera un feed para cada cuenta de X (pega `https://x.com/bestvinyldeal`, etc.).
   Obtendrás 3 URLs de feed `https://rss.app/feeds/XXXX.xml`.
3. Dáselas a la app de una de estas formas:
   - **Local:** copia `data/feeds.example.json` a `data/feeds.json` y pon las URLs.
   - **GitHub Action:** crea el secret `RSS_FEEDS` con las 3 URLs separadas por coma.

Si hay feeds configurados, la app los usa primero; si no, intenta el método
directo de X (limitado) y, si tampoco, los datos de ejemplo.

### Ingesta manual (100% fiable)
Como el paso 1 puede toparse con el límite de X, hay una vía manual que **siempre
funciona** (usa solo el endpoint fiable). Le pasas URLs o IDs de tweets:

```bash
node scripts/ingest.mjs https://x.com/bestvinyldeal/status/2069597877736034550
# o varios, o --file ids.txt
```

Para automatización sin depender del límite, lo mejor es el **GitHub Action**
(corre cada 30 min desde IPs distintas) o migrar el paso 1 a un puente RSS / la
API oficial de X.

---

## 🚀 Puesta en marcha

Requiere **Node 18+** (no hay dependencias que instalar).

```bash
# 1) Arranca la web
npm start
# -> abre http://localhost:3000

# 2) Lee X una vez por consola (refresca el feed y manda alertas)
npm run fetch

# 3) Modo bucle (sondea cada POLL_INTERVAL_MIN minutos, por defecto 15)
npm run poll
```

Desde la web puedes pulsar **«↻ Refrescar X»** para forzar una lectura.

---

## 🔔 Alertas por WhatsApp (gratis con CallMeBot)

No existe una API oficial gratis de WhatsApp, así que usamos
[CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/), que te
permite enviarte mensajes a ti mismo. Activación (una sola vez):

1. Añade el número **+34 644 51 95 23** a tus contactos de WhatsApp.
2. Envíale el mensaje: `I allow callmebot to send me messages`.
3. Te responde con tu **apikey**.

Luego define estas variables de entorno antes de arrancar:

```bash
export WHATSAPP_PHONE=573001112233      # tu número con prefijo, sin + ni espacios
export CALLMEBOT_APIKEY=123456          # la apikey que te dio CallMeBot
npm run fetch
```

Prueba el canal con el botón **«Enviar alerta de prueba»** de la web.

> ¿Prefieres otro canal (Telegram, email, etc.)? El notificador está aislado en
> `src/notifier.mjs`. También puedes apuntar `ALERT_WEBHOOK_URL` a cualquier
> webhook (Make, Zapier, n8n…) y recibir el deal como JSON.

---

## 🎨 Enriquecimiento de género/sello (Discogs / MusicBrainz)

Los tweets casi nunca dicen el género o el sello, así que la app los completa
sola consultando una base musical (`src/enrich.mjs`), con caché en
`data/enrich-cache.json`:

- **Discogs** (recomendado para vinilo): da género + estilo + sello en una
  consulta. Necesita un token gratis: entra en
  [discogs.com/settings/developers](https://www.discogs.com/settings/developers),
  pulsa *Generate token* y guárdalo en la variable `DISCOGS_TOKEN`.
- **MusicBrainz** (respaldo): se usa automáticamente si no hay token. Sin clave,
  pero con géneros más pobres.

Desactivar el enriquecimiento: `ENRICH=0`.

```bash
export DISCOGS_TOKEN=tuTokenDeDiscogs   # opcional pero recomendado
npm run fetch
```

## 🤖 Modo desatendido (GitHub Actions)

`.github/workflows/poll.yml` lee X cada 30 min desde los runners de GitHub (con
IPs distintas, que suelen esquivar el límite de X), enriquece y te avisa por
WhatsApp. Solo alerta de datos **reales** (`LIVE_ONLY=1`), nunca de la demo.

Para activarlo, en el repo: `Settings → Secrets and variables → Actions` y crea:
- `WHATSAPP_PHONE`
- `CALLMEBOT_APIKEY`
- `DISCOGS_TOKEN` (opcional, mejora géneros/sellos)
- `ALERT_WEBHOOK_URL` (opcional)

El workflow recuerda qué deals ya te notificó y la caché de enriquecimiento
(`data/seen.json`, `data/enrich-cache.json`) para no repetir avisos ni consultas.

---

## 🎚️ Filtros y alertas

En la barra lateral de la web defines **listas de alerta**. Cada lista puede
combinar:

| Campo        | Ejemplo                  |
|--------------|--------------------------|
| Artistas     | `Pink Floyd, Radiohead`  |
| Géneros      | `Jazz, Soul`             |
| Sellos       | `Blue Note, Warp`        |
| Palabras     | `180g, box set`          |
| Precio máx   | `25`                     |
| Dto mínimo % | `30`                     |

Un deal dispara una alerta si cumple las restricciones de precio/descuento **y**
casa con al menos uno de los criterios listados. Vienen 3 listas de ejemplo
(`data/watchlists.default.json`): *Jazz clásico barato*, *Mis artistas* y
*Gangas (>30% dto)*.

### Descubrimiento
La lista especial **Descubrimiento** te avisa de deals de artistas que **no**
sigues pero cuyo género/sello encaja con lo que te gusta — la forma de ir
encontrando cosas nuevas. Ajusta sus géneros/sellos/precio en la web.

---

## 🗂️ Estructura

```
server.mjs                 Servidor HTTP (sin deps) + API REST
scripts/
  run-fetch.mjs            CLI de lectura automática (una vez o --watch)
  ingest.mjs               Ingesta manual fiable (pegando URLs/IDs de tweets)
src/
  twitter.mjs              Lee X: descubre IDs + hidrata por tweet-result
  fetcher.mjs              Orquesta las 3 cuentas, fallback a ejemplo
  parser.mjs               Extrae artista/álbum/sello/género/precio/Amazon
  enrich.mjs               Completa género/sello vía Discogs/MusicBrainz
  filters.mjs              Motor de coincidencias + descubrimiento
  notifier.mjs             WhatsApp (CallMeBot) + webhook
  store.mjs                Persistencia JSON
  refresh.mjs              Orquesta fetch->parse->enrich->store->match->notify
public/                    Interfaz web (HTML/CSS/JS)
data/
  catalog.json             Catálogo artista->género/sello (extensible)
  real-tweets-fixture.json Datos reales de ejemplo (fallback demo)
  watchlists.default.json  Listas de alerta por defecto
```

---

## 🛣️ Siguientes pasos posibles

- Resolver `amzn.to` para mostrar carátula y título exacto del producto.
- Histórico de precios por álbum (avisar solo si es mínimo histórico).
- Migrar el `fetcher` a la API oficial de X o a un scraper si lo gratis falla.
- Desplegar la web (Render, Fly.io, un VPS) para tenerla siempre online.
