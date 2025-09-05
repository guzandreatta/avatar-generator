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

async function cancelPrediction(idOrCancelUrl: string, token: string) {
  const url = idOrCancelUrl.startsWith('http')
    ? idOrCancelUrl
    : `https://api.replicate.com/v1/predictions/${idOrCancelUrl}/cancel`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
  });
}

async function pollPrediction(
  idOrGetUrl: string,
  token: string,
  log: (m: string) => void,
  opts?: { maxStartingSeconds?: number }
) {
  const pollUrl = idOrGetUrl?.startsWith?.('http')
    ? idOrGetUrl
    : `https://api.replicate.com/v1/predictions/${idOrGetUrl}`;

  const startedAt = Date.now();
  let tick = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await fetch(pollUrl, { headers: { Authorization: `Token ${token}` } });
    const j2 = await r2.json();
    tick++;
    log(`poll #${tick} → ${j2.status}`);
    if (j2.status === 'succeeded') return { output: j2.output, cancelUrl: j2.urls?.cancel, id: j2.id };
    if (j2.status === 'failed' || j2.status === 'canceled') {
      const detail = j2?.error || 'Prediction failed';
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    if (j2.status === 'starting' && opts?.maxStartingSeconds) {
      const secs = (Date.now() - startedAt) / 1000;
      if (secs > opts.maxStartingSeconds) {
        const id = j2.id;
        const cancelUrl = j2.urls?.cancel;
        const err: any = new Error('Timeout starting prediction');
        err.code = 'E_TIMEOUT_STARTING';
        err.id = id;
        err.cancelUrl = cancelUrl;
        throw err;
      }
    }
  }
}

// ===================== Lógica principal =====================

type GenerateBody = {
  imageUrl: string;
  // Estos ya no afectan a Kontext (usa aspect_ratio)
  strength?: number;
  width?: number;
  height?: number;
};

const FIXED_PROMPT = process.env.AVATAR_PROMPT || 'Make this a 90s cartoon';

function buildInputForModel(modelEnv: string, body: GenerateBody, log: (m: string) => void) {
  const isKontext = /flux[-_.]?kontext/.test(modelEnv.toLowerCase());

  if (isKontext) {
    // FLUX Kontext Pro: prompt + input_image + aspect_ratio
    // Sugerido: 'match_input_image' para respetar el AR de la foto. :contentReference[oaicite:2]{index=2}
    const input: Record<string, any> = {
      prompt: FIXED_PROMPT,
      input_image: body.imageUrl,
      aspect_ratio: 'match_input_image',
    };
    log(`detected kontext • input keys: ${Object.keys(input).join(', ')}`);
    return input;
  }

  // Genérico (otros modelos img2img)
  const input: Record<string, any> = {
    prompt: FIXED_PROMPT,
    ...(typeof body.strength === 'number' ? { strength: body.strength } : {}),
    ...(typeof body.width === 'number' ? { width: body.width } : {}),
    ...(typeof body.height === 'number' ? { height: body.height } : {}),
    num_inference_steps: 28,
    guidance_scale: 5,
    image: body.imageUrl,
  };
  log(`generic model • input keys: ${Object.keys(input).join(', ')}`);
  return input;
}

async function runOnce(
  payload: GenerateBody,
  envs: { blobToken: string; replicateToken: string; modelEnv: string; byVersion?: boolean },
  log: (m: string) => void,
  startingTimeoutSec: number
) {
  const t0 = Date.now();
  const { blobToken, replicateToken, modelEnv, byVersion } = envs;

  log(`start • prompt="${FIXED_PROMPT}"`);
  log(`image: ${payload.imageUrl}`);

  // 1) Input
  const input = buildInputForModel(modelEnv, payload, log);

  // 2) Crear predicción
  let createRes: Response;
  let ref = parseModelEnv(modelEnv);

  if (!byVersion && ref.kind === 'ownerName') {
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
    // Forzamos por versión (más estable cuando hay problemas)
    const version =
      ref.kind === 'version' ? ref.version : (await fetchLatestVersionId(ref.owner, ref.name, replicateToken));
    log(`create by version: ${version}`);
    createRes = await createPredictionByVersion(version, input, replicateToken);
    if (!createRes.ok) throw new Error(`Replicate error (by version): ${await createRes.text()}`);
  }

  const pred = await createRes.json();
  log(`prediction id: ${pred.id || '(none)'} ${pred.urls?.web ? `→ ${pred.urls.web}` : ''}`);

  // 3) Poll con timeout para "starting"
  const polled = await pollPrediction(pred.id || pred.urls?.get, replicateToken, log, {
    maxStartingSeconds: startingTimeoutSec,
  });

  const outUrl: string | null = Array.isArray(polled.output)
    ? polled.output[0]
    : typeof polled.output === 'string'
    ? polled.output
    : null;

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

async function runWithRetry(
  payload: GenerateBody,
  envs: { blobToken: string; replicateToken: string; modelEnv: string },
  log: (m: string) => void
) {
  const STARTING_TIMEOUT = Number(process.env.REPLICATE_STARTING_TIMEOUT_SEC || 90);
  const MAX_RETRIES = Number(process.env.REPLICATE_MAX_RETRIES || 1); // 1 reintento adicional

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const byVersion = attempt > 0; // en el reintento forzamos por versión
      if (attempt > 0) log(`retry attempt #${attempt} (forcing version)…`);
      return await runOnce(payload, { ...envs, byVersion }, log, STARTING_TIMEOUT);
    } catch (e: any) {
      // Si es timeout en "starting", intentamos cancelar y reintentar
      if (e?.code === 'E_TIMEOUT_STARTING') {
        log(`timeout while starting (>${STARTING_TIMEOUT}s). Cancelling…`);
        try {
          const cancelTarget = e.cancelUrl || e.id;
          if (cancelTarget) await cancelPrediction(cancelTarget, envs.replicateToken);
          log('cancelled.');
        } catch (cancelErr: any) {
          log(`cancel failed: ${cancelErr?.message || String(cancelErr)}`);
        }
        if (attempt < MAX_RETRIES) {
          log('will retry…');
          continue;
        }
      }
      // otros errores -> salir
      throw e;
    }
  }
  // no debería llegar acá
  throw new Error('Exhausted retries');
}

// ===================== Route handler =====================

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const stream = searchParams.get('stream') === '1';

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const modelEnv = process.env.REPLICATE_MODEL;

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
    return new NextResponse(`ERROR:${msg}\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const body = (await req.json()) as GenerateBody;

  if (!stream) {
    try {
      const url = await runWithRetry(body, { blobToken, replicateToken, modelEnv }, (m) =>
        console.log('[generate]', m)
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
      const url = await runWithRetry(body, { blobToken, replicateToken, modelEnv }, log);
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
