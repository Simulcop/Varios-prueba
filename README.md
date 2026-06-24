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

X cerró casi todo su acceso gratuito. Esta app lee los timelines **públicos** a
través del endpoint de *syndication* (el mismo que usan los widgets embebidos de
X) — **sin API key**. Eso funciona desde cualquier red con salida a `x.com`:

- ✅ Tu ordenador / un servidor / un GitHub Action.
- ❌ Algunos entornos en la nube bloquean X. En ese caso la app **cae
  automáticamente a datos de ejemplo** (`data/sample-deals.json`) y lo señala con
  la etiqueta «datos de ejemplo» para que la interfaz siga siendo usable.

Si X bloqueara el endpoint en el futuro, el `fetcher` está aislado en
`src/fetcher.mjs` y se puede cambiar por la API oficial o un scraper de pago sin
tocar el resto.

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

## 🤖 Modo desatendido (GitHub Actions)

`.github/workflows/poll.yml` lee X cada 30 min desde los runners de GitHub (que sí
tienen acceso a X) y te avisa por WhatsApp. Para activarlo, en el repo:

`Settings → Secrets and variables → Actions` y crea:
- `WHATSAPP_PHONE`
- `CALLMEBOT_APIKEY`
- `ALERT_WEBHOOK_URL` (opcional)

El workflow recuerda qué deals ya te notificó (cache de `data/seen.json`) para no
repetir avisos.

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
scripts/run-fetch.mjs      CLI de lectura (una vez o --watch)
src/
  fetcher.mjs              Lee X (syndication) con fallback a ejemplo
  parser.mjs              Extrae artista/álbum/sello/género/precio/Amazon
  filters.mjs             Motor de coincidencias + descubrimiento
  notifier.mjs            WhatsApp (CallMeBot) + webhook
  store.mjs               Persistencia JSON
  refresh.mjs             Orquesta fetch->parse->store->match->notify
public/                    Interfaz web (HTML/CSS/JS)
data/
  catalog.json            Catálogo artista->género/sello (extensible)
  sample-deals.json       Datos de ejemplo (fallback demo)
  watchlists.default.json Listas de alerta por defecto
```

---

## 🛣️ Siguientes pasos posibles

- Resolver `amzn.to` para mostrar carátula y título exacto del producto.
- Histórico de precios por álbum (avisar solo si es mínimo histórico).
- Migrar el `fetcher` a la API oficial de X o a un scraper si lo gratis falla.
- Desplegar la web (Render, Fly.io, un VPS) para tenerla siempre online.
