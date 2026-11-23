# Proyecto — Curaduría de vinilos (Juan Daniel)

## Método "tripleta"
Al evaluar un vinilo se decide con **tres ejes**:
1. **Edición** (Discogs): qué prensado exacto es.
2. **Planta / mastering** (runout/deadwax, créditos): quién cortó y dónde se prensó.
3. **DR** (dr.loudness-war.info): rango dinámico.

## Reglas permanentes
- **Mostrar la ficha/detalles ANTES de agregar** y pedir un "sí" explícito.
- **No asumas nada**: verificar por runout/deadwax/barcode/créditos.
- **"Deadwax manda"**: si el runout contradice la ficha, gana el runout.
- Compra solo desde **USA** (envío).
- Plantas top: QRP, RTI, Optimal, Pallas, Record Industry, SRC, PRS Hannover,
  Columbia (Terre Haute/Carrollton/Pitman/Santa Maria).
- **Descarte del usuario**: Rainbo, GZ Media, URP (salvo excepción que él apruebe).

## Perfil de gusto (Juan Daniel)
- Lanes: indie rock, electrónica, rap/hip-hop, y jazz.
- Jazz: le emocionan el **tenor soulful** (Stanley Turrentine, Ben Webster) y la
  **voz** (Sheila Jordan, Billie, Nina). Prefiere lo **melódico/soulful y con matices**.
- El **groove pesado de órgano/vibráfono a veces lo empalaga** — NO es anti-vibráfono
  (ama *Time for Tyner* con Hutcherson), es cuestión de mood. "Días de días".
  → No saturar de boogaloo-órgano; balancear con baladas/voz/tenor cálido.

## Carpetas Discogs (usuario `juanDanielCaro`)
- Audiófilos: 9636592
- Audiófilos Jazz: 9638958
- Audiófilos Electrónica: 9641811
- Autografiados: 9641630
- Uncategorized: 1

## Referencias (usar al evaluar discos)
- **Jazz** — `data/jazz-reference/`: **Penguin Core Collection** (canon esencial)
  y **Crown Albums** (favoritos de los críticos). Marcar si un disco es
  **Core 📚** y/o **Crown 👑**.
- **Rock/indie/electrónica/etc.** — `data/pitchfork-reference/`: listas de mejores
  álbumes de Pitchfork (indie all-time, por década 1960s–2020s, electrónica).
  Marcar si aparece y en qué puesto.
En ambos casos, cruzar contra su colección (Discogs `juanDanielCaro`) para
wishlists de canon faltante.

## Flujo de cambios en la colección
Los movimientos/altas/bajas se ejecutan por GitHub Actions que escriben a Discogs:
- `data/folder-move.txt` → workflow "Discogs - organizar en carpeta".
- `data/collection-import.txt` → altas. `data/collection-remove.txt` → bajas.
Hacer `git pull --rebase` antes de push (los workflows commitean al remoto).
