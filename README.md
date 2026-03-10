<h1 align="center">アイリ — Fork Personal</h1>

<p align="center">
  <strong>Este es un fork personal de <a href="https://github.com/moeru-ai/airi">moeru-ai/airi</a></strong><br>
  Contiene todas las funciones originales más mejoras propias centradas en el <strong>VN Reader</strong> y soporte nativo de <strong>AivisSpeech</strong>.
</p>

---

## 🆕 Qué hemos añadido (cambios respecto al original)

Todo lo original de AIRI sigue intacto. Estos son los añadidos exclusivos de este fork:

### 🎮 VN Reader mejorado

El VN Reader permite que AIRI lea y traduzca novelas visuales japonesas en tiempo real usando [Textractor](https://github.com/Artikash/Textractor) como fuente de texto.

#### Cómo funciona

```
Novela Visual → Textractor → textractor_websocket_x86 → WebSocket → AIRI VN Reader → LLM → Traducción + TTS
```

1. Textractor captura el texto del juego y lo envía por WebSocket al puerto configurado (por defecto `9001`)
2. AIRI recibe el texto, lo traduce con el LLM activo y lo lee en voz alta con TTS

#### Configuración paso a paso

1. Instala [Textractor](https://github.com/Artikash/Textractor)
2. Activa el plugin `textractor_websocket_x86` en Textractor
3. Abre AIRI → menú principal → **VN Reader**
4. Activa el toggle **VN Reader activo**
5. Configura el puerto WebSocket (por defecto `9001`, debe coincidir con el plugin)
6. Selecciona el idioma de traducción (**ES** o **EN**)

#### Features añadidas

| Feature | Descripción |
|---|---|
| **Filtro de duplicados mejorado** | Espera 300ms antes de emitir el texto para capturar la versión más larga cuando Textractor envía duplicados parciales |
| **Detección automática de hilo CJK** | Filtra automáticamente los hilos de basura de memoria de Textractor. Solo procesa texto que contenga caracteres japoneses/chinos reales |
| **Separación nombre / diálogo** | Detecta y separa el nombre del personaje del diálogo en formatos como `キャラ「diálogo」` o `キャラ：diálogo`. Muestra el nombre en la UI y lo pasa al LLM como contexto |
| **Contexto acumulado** | Pasa las últimas N líneas al LLM para mejorar la coherencia en nombres, pronombres y referencias. Configurable (0–5 líneas) |
| **Diccionario de nombres propios** | Define traducciones fijas para nombres propios que el LLM debe respetar siempre. Por ejemplo: `薙原` → `Nagihara` |
| **Historial de líneas** | Guarda las últimas 20 líneas traducidas con nombre del personaje, texto japonés, traducción y reacción de AIRI |

#### Reacciones de AIRI

El prompt del LLM instruye a AIRI para que añada una breve reacción personal aproximadamente 1 de cada 5 líneas. AIRI actúa como una entidad digital curiosa que lee la historia junto al usuario y tiene opiniones sobre lo que ocurre.

---

### 🔊 AivisSpeech — Proveedor TTS nativo

[AivisSpeech](https://aivis-project.com/) es un motor TTS japonés de alta calidad que corre localmente.

#### Configuración

1. Descarga e instala [AivisSpeech](https://aivis-project.com/)
2. Abre AivisSpeech (corre en `http://localhost:10101` por defecto)
3. En AIRI → **Settings** → **Speech** → pulsa **+**
4. Selecciona **AivisSpeech**
5. La Base URL por defecto es `http://localhost:10101` — cambia solo si usas otro puerto
6. Las voces disponibles se cargan automáticamente desde AivisSpeech
7. Selecciona una voz y pulsa **Test Voice** para probar

#### Voces incluidas en AivisSpeech

AivisSpeech incluye varias voces japonesas de alta calidad como まお (Mao). Las voces disponibles varían según los modelos instalados en tu AivisSpeech.

---

## 📖 Documentación original

Para el resto de funciones de AIRI (chat, Minecraft, Factorio, VTuber, etc.) consulta la [documentación oficial](https://airi.moeru.ai/docs/) y el [repositorio original](https://github.com/moeru-ai/airi).

---

## 📄 Licencia

[MIT](./LICENSE) — igual que el proyecto original.
