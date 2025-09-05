// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// --------- Tipos & utils ---------
type ModelRef =
  | { kind: 'ownerName'; owner: string; name: string; version?: string }
  | { kind: 'version'; version: string };

type GenerateBody = {
  imageUrl: string;   // URL pública subida antes a Blob
  strength?: number;  // 0..1 (si tu modelo lo soporta)
  width?: number;     // opcional, si el modelo lo soporta
  height?: number;    // opcional
};

function parseModelEnv(modelEnv?: string): ModelRef {
  if (!modelEnv) throw new Error('Missing REPLICATE_MODEL');
  if (modelEnv.includes('/')) {
    const [owner, rest] = modelEnv.split('/');
    const [name, version] = rest.split(':');
    return { kind: 'ownerName', owner, name, version: version || undefined };
  }
  return { kind: 'version', version: modelEnv };
}

async function fetchLatestVersionId(owner: string, name: string, token: string): Promise<string> {
  const url = `https://api.replicate.com/v1/models/${owner}/${name}/versions`;
  const r = await fetch(url, {
    headers: { Authorization: `Token ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Could not fetch versions for ${owner}/${name}: ${await r.text()}`);
  const j = await r.json() as any;
  const list = Array.isArray(j) ? j : j.results;
  if (!Array.isArray(list) || !list.length) throw new Error(`No versions for ${owner}/${name}`);
  const latest = list[0];
  const id = latest?.id || latest?.version || latest;
  if (typeof id !== 'string') throw new Error(`Invalid versions payload for ${owner}/${name}`);
  return id;
}

async function createPredictionByModel(owner: string, name: string, input: any, token: string) {
  const url = `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }), // sin "model" ni "version" aquí
  });
}

async function createPredictionByVersion(version: string, input: any, token: string) {
  const url = 'https://api.replicate.com/v1/predictions';
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  });
}

async function pollPrediction(idOrGetUrl: string, token: string) {
  const pollUrl = idOrGetUrl.startsWith('http')
    ? idOrGetUrl
    : `https://api.replicate.com/v1/predictions/${idOrGetUrl}`;

  while (true) {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(pollUrl, { headers: { Authorization: `Token ${token}` } });
    const j2 = await r2.json();
    if (j2.status === 'succeeded') return j2.output;
    if (j2.status === 'failed' || j2.status === 'canceled') {
      throw new Error('Prediction failed');
    }
  }
}

// --------- Handler ---------
export async function POST(req: NextRequest) {
  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    const modelEnv = process.env.REPLICATE_MODEL;
    const imageKey = process.env.REPLICATE_IMAGE_KEY || 'image'; // ej: 'image', 'input_image', 'image_prompt'

    if (!blobToken)        return NextResponse.json({ error: 'Missing BLOB_READ_WRITE_TOKEN' }, { status: 500 });
    if (!replicateToken)   return NextResponse.json({ error: 'Missing REPLICATE_API_TOKEN' }, { status: 500 });
    if (!modelEnv)         return NextResponse.json({ error: 'Missing REPLICATE_MODEL' }, { status: 500 });

    const {
      imageUrl,
      strength,
      width,
      height,
    } = (await req.json()) as GenerateBody;

    if (!imageUrl) {
      return NextResponse.json({ error: 'Falta imageUrl' }, { status: 400 });
    }

    // ✅ PROMPT FIJO (puedes editarlo por env var AVATAR_PROMPT si querés)
    const FIXED_PROMPT = process.env.AVATAR_PROMPT || 'Make this a 90s cartoon';

    // Construimos el input del modelo
    const input: Record<string, any> = {
      prompt: FIXED_PROMPT,
      // Los siguientes campos se incluyen solo si vienen definidos en el body
      ...(typeof strength === 'number' ? { strength } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      // Hiperparámetros comunes; ignóralos si tu modelo no los usa
      num_inference_steps: 28,
      guidance_scale: 5,
    };
    // clave de imagen configurable
    input[imageKey] = imageUrl;

    // Crear predicción (robusto)
    const ref = parseModelEnv(modelEnv);
    let createRes: Response;

    if (ref.kind === 'ownerName') {
      createRes = await createPredictionByModel(ref.owner, ref.name, input, replicateToken);
      if (!createRes.ok) {
        const status = createRes.status;
        if (status === 404 || status === 422) {
          const version = ref.version || (await fetchLatestVersionId(ref.owner, ref.name, replicateToken));
          createRes = await createPredictionByVersion(version, input, replicateToken);
          if (!createRes.ok) {
            throw new Error(`Replicate error (fallback by version): ${await createRes.text()}`);
          }
        } else {
          throw new Error(`Replicate error (by model): ${await createRes.text()}`);
        }
      }
    } else {
      createRes = await createPredictionByVersion(ref.version, input, replicateToken);
      if (!createRes.ok) throw new Error(`Replicate error (by version): ${await createRes.text()}`);
    }

    const pred = await createRes.json();
    const out = await pollPrediction(pred.id || pred.urls?.get, replicateToken);

    const url: string | null =
      Array.isArray(out) ? out[0] : (typeof out === 'string' ? out : null);
    if (!url) throw new Error('No output from model');

    // Re-host en Blob
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error('Could not fetch model output');
    const buffer = await imgRes.arrayBuffer();

    const outName = `outputs/${Date.now()}-avatar.png`;
    const saved = await put(outName, new Blob([buffer], { type: 'image/png' }), {
      access: 'public',
      token: blobToken,
    });

    return NextResponse.json({ outputUrl: saved.url });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: 'Server error', detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
