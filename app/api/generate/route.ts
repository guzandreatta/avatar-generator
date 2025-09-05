// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ===================== Helpers de Replicate =====================

type ModelRef =
  | { kind: 'ownerName'; owner: string; name: string; version?: string }
  | { kind: 'version'; version: string };

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
  const r = await fetch(url, { headers: { Authorization: `Token ${token}` }, cache: 'no-store' });
  if (!r.ok) throw new Error(`Could not fetch versions for ${owner}/${name}: ${await r.text()}`);
  const j = (await r.json()) as any;
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
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }), // NO "model" ni "version" aquí
  });
}

async function createPredictionByVersion(version: string, input: any, token: string) {
  const url = 'https://api.replicate.com/v1/predictions';
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, input }),
  });
}

async function pollPrediction(idOrGetUrl: string, token: string, log: (m: string) => void) {
  const pollUrl = idOrGetUrl.startsWith('http')
    ? idOrGetUrl
    : `https://api.replicate.com/v1/predictions/${idOrGetUrl}`;

  let tick = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(pollUrl, { headers: { Authorization: `Token ${token}` } });
    const j2 = await r2.json();
    tick++;
    log(`poll #${tick} → ${j2.status}`);
    if (j2.status === 'succeeded') return j2.output;
    if (j2.status === 'failed' || j2.status === 'canceled') {
      throw new Error('Prediction failed');
    }
  }
}

// ===================== Lógica principal (compartida) =====================

type GenerateBody = {
  imageUrl: string;
  strength?: number;
  width?: number;
  height?: number;
};

const FIXED_PROMPT = process.env.AVATAR_PROMPT || 'Make this a 90s cartoon';

async function runPipeline(
  payload: GenerateBody,
  envs: {
    blobToken: string;
    replicateToken: string;
    modelEnv: string;
    imageKey: string;
  },
  log: (m: string) => void
) {
  const t0 = Date.now();
  const { imageUrl, strength, width, height } = payload;
  const { blobToken, replicateToken, modelEnv, imageKey } = envs;

  log(`start • prompt="${FIXED_PROMPT}"`);
  log(`image: ${imageUrl}`);

  // 1) Preparar input del modelo
  const input: Record<string, any> = {
    prompt: FIXED_PROMPT,
    ...(typeof strength === 'number' ? { strength } : {}),
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
    num_inference_steps: 28,
    guidance_scale: 5,
  };
  input[imageKey] = imageUrl;
  log(`input keys: ${Object.keys(input).join(', ')}`);

  // 2) Crear predicción (robusto)
  const ref = parseModelEnv(modelEnv);
  let createRes: Response;

  if (ref.kind === 'ownerName') {
    log(`create by model: ${ref.owner}/${ref.name}`);
    createRes = await createPredictionByModel(ref.owner, ref.name, input, replicateToken);
    if (!createRes.ok) {
      const status = createRes.status;
      log(`create by model failed (${status}), trying by version…`);
      if (status === 404 || status === 422) {
        const version = ref.version || (await fetchLatestVersionId(ref.owner, ref.name, replicateToken));
        log(`resolved version: ${version}`);
        createRes = await createPredictionByVersion(version, input, replicateToken);
        if (!createRes.ok) throw new Error(`Replicate error (fallback): ${await createRes.text()}`);
      } else {
        throw new Error(`Replicate error (by model): ${await createRes.text()}`);
      }
    }
  } else {
    log(`create by version: ${ref.version}`);
    createRes = await createPredictionByVersion(ref.version, input, replicateToken);
    if (!createRes.ok) throw new Error(`Replicate error (by version): ${await createRes.text()}`);
  }

  const pred = await createRes.json();
  log(`prediction id: ${pred.id || '(none)'}`);

  // 3) Poll hasta terminar
  const out = await pollPrediction(pred.id || pred.urls?.get, replicateToken, log);

  const outUrl: string | null = Array.isArray(out) ? out[0] : typeof out === 'string' ? out : null;
  if (!outUrl) throw new Error('No output from model');
  log(`output url: ${outUrl}`);

  // 4) Re-host en Blob
  log('downloading output…');
  const imgRes = await fetch(outUrl);
  if (!imgRes.ok) throw new Error('Could not fetch model output');
  const buffer = await imgRes.arrayBuffer();

  const outName = `outputs/${Date.now()}-avatar.png`;
  log(`uploading to blob: ${outName}`);
  const saved = await put(outName, new Blob([buffer], { type: 'image/png' }), {
    access: 'public',
    token: blobToken,
  });

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${dt}s`);
  return saved.url as string;
}

// ===================== Route handler =====================

export async function POST(req: NextRequest) {
  // ¿Streaming de logs?
  const { searchParams } = new URL(req.url);
  const stream = searchParams.get('stream') === '1';

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const modelEnv = process.env.REPLICATE_MODEL;
  const imageKey = process.env.REPLICATE_IMAGE_KEY || 'image';

  if (!blobToken || !replicateToken || !modelEnv) {
    const missing = [
      !blobToken && 'BLOB_READ_WRITE_TOKEN',
      !replicateToken && 'REPLICATE_API_TOKEN',
      !modelEnv && 'REPLICATE_MODEL',
    ]
      .filter(Boolean)
      .join(', ');
    const msg = `Missing env: ${missing}`;
    if (!stream) return NextResponse.json({ error: msg }, { status: 500 });
    // en modo stream devolvemos una sola línea de error
    return new NextResponse(`error: ${msg}\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const body = (await req.json()) as GenerateBody;

  if (!stream) {
    try {
      const url = await runPipeline(
        body,
        { blobToken, replicateToken, modelEnv, imageKey },
        (m) => console.log('[generate]', m)
      );
      return NextResponse.json({ outputUrl: url });
    } catch (e: any) {
      console.error(e);
      return NextResponse.json({ error: 'Server error', detail: e?.message || String(e) }, { status: 500 });
    }
  }

  // ----- Streaming de logs -----
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const log = async (msg: string) => {
    console.log('[generate]', msg);
    await writer.write(enc.encode(msg + '\n'));
  };

  (async () => {
    try {
      const url = await runPipeline(body, { blobToken, replicateToken, modelEnv, imageKey }, log);
      await log(`RESULT:${url}`);
    } catch (e: any) {
      await log(`ERROR:${e?.message || String(e)}`);
    } finally {
      writer.close();
    }
  })();

  return new NextResponse(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
