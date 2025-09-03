// app/api/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

function cfEndpoint(account: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // hasta 5 min

type GenerateBody = {
  name?: string;
  imageUrl: string; // URL pública de la foto subida (Blob)
  strength?: number; // 0..1 (0.4–0.6 ≈ más parecido a la foto)
  guidance?: number; // ~7.5 por defecto
  steps?: number;    // máx 20 en este modelo
  width?: number;    // 256..2048
  height?: number;   // 256..2048
};

async function urlToBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer la imagen source: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString('base64');
  return { b64, arrayBuffer };
}

function validateCfAccountId(id?: string) {
  if (!id) return 'CLOUDFLARE_ACCOUNT_ID (o CF_ACCOUNT_ID) no seteado';
  if (id.includes('@')) {
    return 'El Account ID no puede ser un email; debe ser el ID de 32 caracteres (Dashboard → Account Home/Overview).';
  }
  if (!/^[a-fA-F0-9]{32}$/.test(id)) {
    return 'Account ID inválido: debe ser un string hex de 32 caracteres.';
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

    // ✅ Nuevos nombres de Cloudflare con fallback a los viejos
    const CF_ACCOUNT_ID =
      process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
    const CF_API_TOKEN =
      process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

    if (!BLOB_TOKEN)
      return NextResponse.json({ error: 'Missing BLOB_READ_WRITE_TOKEN' }, { status: 500 });

    const idErr = validateCfAccountId(CF_ACCOUNT_ID);
    if (idErr) return NextResponse.json({ error: idErr }, { status: 500 });

    if (!CF_API_TOKEN)
      return NextResponse.json(
        { error: 'Missing CLOUDFLARE_API_TOKEN (o CF_API_TOKEN)' },
        { status: 500 }
      );

    const {
      name,
      imageUrl,
      strength = 0.5,
      guidance = 7.5,
      steps = 20,
      width = 1024,
      height = 1024,
    } = (await req.json()) as GenerateBody;

    if (!imageUrl) {
      return NextResponse.json({ error: 'Falta imageUrl (URL pública de la foto)' }, { status: 400 });
    }

    // 1) Pasar la foto a base64 para el endpoint img2img
    const { b64: sourceB64 } = await urlToBase64(imageUrl);

    // 2) Prompt
    const prompt =
      `Stylized avatar portrait of the person in the photo, centered head-and-shoulders, clean background, ` +
      `coherent colors, professional avatar, high detail. ${name ? `Name: ${name}.` : ''}`;

    // 3) Llamar al modelo de Cloudflare
    const endpoint = cfEndpoint(CF_ACCOUNT_ID!);
    const cfRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_b64: sourceB64,
        strength,               // 0..1
        guidance,               // ~7.5
        num_steps: Math.min(steps, 20),
        width,
        height,
      }),
    });

    const ct = cfRes.headers.get('content-type') || '';
    if (!cfRes.ok) {
      const detail = ct.includes('application/json') ? await cfRes.text() : `status=${cfRes.status}`;
      return NextResponse.json(
        {
          error: `Cloudflare AI error ${cfRes.status}`,
          hint:
            cfRes.status === 404
              ? 'Revisá CLOUDFLARE_ACCOUNT_ID / CF_ACCOUNT_ID (debe ser el ID de 32 caracteres, NO tu email).'
              : cfRes.status === 403
              ? 'Revisá CLOUDFLARE_API_TOKEN / CF_API_TOKEN (permisos Workers AI: Run).'
              : undefined,
          detail,
          endpoint,
        },
        { status: 500 }
      );
    }

    // 4) Guardar en Blob (la respuesta suele ser binaria image/png)
    const resultArrayBuffer = await cfRes.arrayBuffer();
    const fileName = `avatars/${Date.now()}.png`;
    const saved = await put(fileName, resultArrayBuffer, {
      access: 'public',
      token: BLOB_TOKEN,
      contentType: 'image/png',
    });

    return NextResponse.json({ url: saved.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Fallo al generar avatar', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
