// app/api/generate/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // hasta 5 min para inferencias lentas

// Negatives genéricos para limpiar el output
const NEGATIVE = [
  'nsfw, lowres, jpeg artifacts, blurry, noisy, pixelated',
  'bad anatomy, deformed, disfigured, extra limbs, extra fingers, multiple heads',
  'text, watermark, logo, signature, cropped, out of frame'
].join(', ');

// Llama a Replicate usando el endpoint por modelo: /v1/models/{owner}/{name}/predictions
async function callReplicatePhotomaker(input: Record<string, any>) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_MODEL || 'tencentarc/photomaker';

  if (!token) throw new Error('Missing REPLICATE_API_TOKEN');
  if (!model) throw new Error('Missing REPLICATE_MODEL');

  const create = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input })
  });

  if (!create.ok) {
    const err = await create.text();
    throw new Error(`Replicate error: ${err}`);
  }

  const pred = await create.json();

  // Polling hasta que termine
  let status: string = pred.status;
  let output = pred.output;
  // Si hay ID, usamos /v1/predictions/{id}; si no, fallback a pred.urls.get
  const pollUrl: string = pred.id
    ? `https://api.replicate.com/v1/predictions/${pred.id}`
    : (pred.urls?.get as string);

  while (status === 'starting' || status === 'processing') {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const j2 = await r2.json();
    status = j2.status;
    output = j2.output;

    if (status === 'failed' || status === 'canceled') {
      throw new Error('Prediction failed');
    }
  }

  // PhotoMaker suele devolver un array con URLs
  const url: string | null = Array.isArray(output) ? output[0] : (typeof output === 'string' ? output : null);
  if (!url) throw new Error('No output from model');
  return url;
}

export async function POST(req: Request) {
  try {
    // --- Validación de envs críticas ---
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return new NextResponse('Missing BLOB_READ_WRITE_TOKEN', { status: 500 });
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return new NextResponse('Missing REPLICATE_API_TOKEN', { status: 500 });
    }

    const form = await req.formData();
    const name = String(form.get('name') || 'Usuario');
    const promptBase = String(
      form.get('prompt') ||
        'clean studio portrait, neutral background, high quality, soft lighting'
    );
    const photo = form.get('photo');

    if (!photo || !(photo instanceof File)) {
      return new NextResponse('Missing user photo', { status: 400 });
    }

    // 1) Subimos la foto del usuario a Blob para obtener URL pública
    const inName = `inputs/${Date.now()}-${(photo as File).name}`;
    const uploaded = await put(inName, photo as File, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN, // importante: no exponer al cliente
    });

    // 2) Armamos el prompt para PhotoMaker
    //    PhotoMaker usa la palabra gatillo `img` para referenciar la identidad/imagen.
    const fullPrompt = `${promptBase}, portrait avatar of ${name} img, front-facing, centered`;

    // 3) Input esperado por PhotoMaker (sin style image; estilo por nombre)
    const input = {
      input_image: uploaded.url, // foto del usuario
      prompt: fullPrompt,        // debe incluir `img`
      negative_prompt: NEGATIVE,

      // Estilo fijo controlado desde env (por ej. "Photographic (Default)")
      style_name: process.env.PHOTOMAKER_STYLE_NAME || 'Photographic (Default)',

      // Hiperparámetros razonables (ajustables)
      style_strength_ratio: 20, // 15–50; 20 es buen punto de partida
      num_steps: 28,
      guidance_scale: 5,
      num_outputs: 1,
      // seed: 0, // opcional: fijar semilla para resultados más deterministas
    };

    // 4) Generamos con Replicate
    const generatedUrl = await callReplicatePhotomaker(input);

    // 5) Re-host del resultado en Blob (guardás tu propia copia)
    const imgRes = await fetch(generatedUrl);
    if (!imgRes.ok) throw new Error('Could not fetch model output');
    const buffer = await imgRes.arrayBuffer();

    const outName = `outputs/${Date.now()}-avatar.jpg`;
    const saved = await put(outName, new Blob([buffer], { type: 'image/jpeg' }), {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return NextResponse.json({ outputUrl: saved.url });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message || 'Server error', { status: 500 });
  }
}
