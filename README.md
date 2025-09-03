# Avatar Generator · MVP

Generador de avatars con **estilo consistente** definido por un admin.
- **Admin** sube una **imagen de referencia** del estilo → obtiene un **Style URL** (público).
- **Usuario** escribe su nombre + sube su **foto** + pega el **Style URL** → se genera un avatar.

> Backend: Next.js (App Router) · Almacenamiento: **Vercel Blob** · Inference: **Replicate**

---

## Demo rápido (local)

1) Requisitos: Node 18+
2) Instalar deps:

```bash
pnpm i   # o npm i / yarn
```

3) Copiar `.env.example` a `.env.local` y completar:

```
REPLICATE_API_TOKEN=tu_token
REPLICATE_MODEL=owner/model-o-version-que-soporte-image-to-image-con-style
BLOB_READ_WRITE_TOKEN=tu_token_blob # desde Vercel (Storage -> Blob)
```

4) Dev:

```bash
pnpm dev  # o npm run dev
```

5) Abrí:
- `/admin` para subir **estilo** y copiar el **Style URL**
- `/` para generar avatars (pegar **Style URL** + subir foto)

---

## Cómo funciona

- **/admin** → sube imagen de **estilo** a Vercel Blob ⇒ devuelve **URL pública**.
- **/** (home) → el usuario sube **foto**, pega **Style URL** y setea prompt base.
- **/api/generate**:
  - Sube la **foto** a Blob.
  - Llama a **Replicate** con `{ image, style_image, prompt }` (ajusta claves según el modelo que elijas).
  - Descarga el resultado y lo vuelve a alojar en Blob ⇒ devuelve `outputUrl`.

> ⚠️ Importante: los **parámetros exactos** del `input` dependen del **modelo** que uses (por ejemplo, pipelines con **InstantID + IP-Adapter** para conservar identidad y aplicar estilo). Cambiá las claves en `app/api/generate/route.ts` según la documentación del modelo elegido.

---

## Modelos recomendados (elige uno y ajusta el `input`)

- Pipelines que combinen **InstantID (para identidad)** + **IP-Adapter (para estilo)** sobre **SDXL/FLUX**.
- Alternativas self-hosted con **ComfyUI** (workflow con IP-Adapter + InstantID).
- Si usas otro proveedor (Together, HF Inference, etc.), adapta la llamada en `callReplicate`.

---

## Persistencia del estilo (roadmap)

Este MVP no guarda el estilo en DB. Opciones para **producción**:
- **Postgres + Prisma** (tabla `StylePreset` con `{ id, name, prompt, url, createdBy }`).
- **Vercel KV** para presets simples.
- **Auth** (NextAuth) para restringir `/admin` solo al equipo.

---

## Seguridad & moderación

- Validar imágenes (dimensiones, peso).
- Moderar contenido/rostros (rechazar NSFW).
- Aviso de privacidad (la foto se usa **solo** para generar el avatar).

---

## Archivos clave

- `app/admin/page.tsx` — sube el **estilo** y muestra el **Style URL**.
- `app/page.tsx` — formulario de usuario (nombre, foto, styleUrl, prompt).
- `app/api/style/route.ts` — sube imagen de estilo a Blob.
- `app/api/generate/route.ts` — genera el avatar y guarda el output.
- `.env.example` — variables necesarias.

¡Éxitos!
# avatar-generator
