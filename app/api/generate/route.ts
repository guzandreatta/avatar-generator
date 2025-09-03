// app/api/generate/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // hasta 5 min

// Negatives genéricos
const NEGATIVE = [
  'nsfw, lowres, jpeg artifacts, blurry, noisy, pixelated',
  'bad anatomy, deformed, disfigured, extra limbs, extra fingers, multiple heads',
  'text, watermark, logo, signature, cropped, out of frame'
].join(', ');

// Resuelve el version_id a partir de REPLICATE_MODEL
// Acepta: "owner/name:version"   |   "<version_id>"
function resolveVersion(modelEnv?: string): string {
  if (!modelEnv) throw new Error('Missing REPLICATE_MODEL');
  // owner/name:version
  if (modelEnv.includes(':')) {
    const [, version] = modelEnv.split(':');
    if (!version) throw new Error('Invalid REPLICATE_MODEL (missing version after colon)');
    return version;
  }
  // Ya es un version_id
  return modelEnv;
}

async function runReplicateWithVersion(version: string, input: Record<string, any>) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Missing REPLICATE_API_TOKEN');

  // Endpoint genérico con 'version'
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input })
  });

  if (!create.ok) {
    const err = await create.text();
    throw new Error(`Replicate error: ${err}`);
  }

  const pred = await create.json();

  // Polling
  let status: string = pred.status;
  let output = pred.output;
  const pollUrl: string = `https://api.replicate.com/v1/predictions/${pred.id}`;

  while (status === 'starting' || status === 'processing') {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    const j2 = await r2.json();
    status = j2.status;
    output = j2.output;
    if (status === 'failed' || status === 'canceled') throw new Error('Prediction failed');
  }

  const url: string | null = Array.isArray(output) ? output[0] : (typeof output === 'string' ? output : null);
  if (!url) throw new Error('No output from model');
  return url;
}

export async function POST(req: Request) {
  try {
    // Validaciones de env
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return new NextResponse('Missing BLOB_READ_WRITE_TOKEN', { status: 500 });
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return new NextResponse('Missing REPLICATE_API_TOKEN', { status: 500 });
    }
    if (!process.env.REPLICATE_MODEL) {
      return new NextResponse('Missing REPLICATE_MODEL', { status: 500 });
    }

    const form = await req.formData();
    const name = String(form.get('name') || 'Usuario');
    const promptBase = String(
      form.get('prompt') || 'clean studio portrait, neutral background, high quality, soft lighting'
    );
    const photo = form.get('photo');

    if (!photo || !(photo instanceof File)) {
      return new NextResponse('Missing user photo', { status: 400 });
    }

    // 1) Sube la foto a Blob para URL pública
    const inName = `inputs/${Date.now()}-${(photo as File).name}`;
    const uploaded = await put(inName, photo as File, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // 2) PhotoMaker requiere la palabra gatillo `img` en el prompt
    const fullPrompt = `${promptBase}, portrait avatar of ${name} img, front-facing, centered`;

    // 3) Input compatible con PhotoMaker / PhotoMaker-Style
    const input = {
      input_image: uploaded.url,
      prompt: fullPrompt,               // debe incluir `img`
      negative_prompt: NEGATIVE,
      style_name: process.env.PHOTOMAKER_STYLE_NAME || 'Photographic (Default)', // opcional
      style_strength_ratio: 20,         // 15–50
      num_steps: 28,
      guidance_scale: 5,
      num_outputs: 1,
      // seed: 0,
    };

    // 4) Ejecuta Replicate usando version_id
    const version = resolveVersion(process.env.REPLICATE_MODEL);
    const generatedUrl = await runReplicateWithVersion(version, input);

    // 5) Re-host en Blob
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
