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
  imageUrl: string;   // URL pública (Blob) de la foto fuente
  // Intensidad de estilización (0..1). 0.75–0.9 = más "dibujo".
  strength?: number;
  width?: number;     // 256..2048
  height?: number;    // 256..2048
  // Modo “oscuro” opcional (splash de rojo estilizado, NO gore realista)
  darkHumor?: boolean;
  bgColor?: string;   // ej: "teal", "#00b3b3", "orange", etc.
};

async function urlToBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer la imagen fuente: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString('base64');
  return b64;
}

function validateAccountId(id?: string) {
  if (!id) return 'CLOUDFLARE_ACCOUNT_ID (o CF_ACCOUNT_ID) no seteado';
  if (id.includes('@')) return 'El Account ID no puede ser un email; debe ser un ID hex de 32 caracteres.';
  if (!/^[a-fA-F0-9]{32}$/.test(id)) return 'Account ID inválido: debe ser un string hex de 32 caracteres.';
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
    const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
    const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

    if (!BLOB_TOKEN) return NextResponse.json({ error: 'Missing BLOB_READ_WRITE_TOKEN' }, { status: 500 });
    const idErr = validateAccountId(CF_ACCOUNT_ID);
    if (idErr) return NextResponse.json({ error: idErr }, { status: 500 });
    if (!CF_API_TOKEN) return NextResponse.json({ error: 'Missing CLOUDFLARE_API_TOKEN (o CF_API_TOKEN)' }, { status: 500 });

    const {
      name,
      imageUrl,
      strength = 0.8, // más alto => más “dibujo”
      width = 1024,
      height = 1024,
      darkHumor = false,
      bgColor = 'teal'
    } = (await req.json()) as GenerateBody;

    if (!imageUrl) {
      return NextResponse.json({ error: 'Falta imageUrl (URL pública de la foto)' }, { status: 400 });
    }

    // 1) Convertimos la foto fuente a base64 para img2img
    const image_b64 = await urlToBase64(imageUrl);

    // 2) Prompt para forzar estilo "dibujo" (sin nombrar artistas)
    const STYLE = [
      'flat 2D cartoon portrait, thick bold black outlines',
      'simple facial features (dot eyes, small nose), big smile',
      'minimal shading, solid flat fills, clean shapes',
      `solid ${bgColor} background`,
      'saturated pastel palette, playful yet unsettling tone',
      'head-and-shoulders, centered, high quality, crisp edges',
      'painted gouache/marker texture but mostly flat color look'
    ].join(', ');

    const DARK = darkHumor
      ? ', stylized red paint splatter on neck area, non-realistic, minimal detail'
      : ', clean neckline, no blood';

    const nameBit = name ? `, portrait of ${name}` : '';

    const prompt = `${STYLE}${DARK}${nameBit}`;

    // 3) Negative prompt para evitar realismo, gradientes y fondos complejos
    const NEGATIVE = [
      'photorealistic, realistic skin, pores, detailed hair, depth of field',
      '3d render, gradients, glossy reflections, complex background, text, watermark, logo',
      'excessive shadows, dramatic lighting, noisy, blurry, artifacts, lowres, pixelated, gore detailed'
    ].join(', ');

    // 4) Llamada a Cloudflare Workers AI (retorna binario)
    const endpoint = cfEndpoint(CF_ACCOUNT_ID!);
    const cfRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_b64,
        strength,           // 0..1 (0.75–0.9 para cartoon marcado)
        guidance: 7.0,
        num_steps: 20,
        width,
        height,
        negative_prompt: NEGATIVE
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
              ? 'Revisá CLOUDFLARE_ACCOUNT_ID (ID de 32 caracteres, NO email).'
              : cfRes.status === 403
              ? 'Revisá CLOUDFLARE_API_TOKEN (permiso Workers AI: Run).'
              : undefined,
          detail,
          endpoint
        },
        { status: 500 }
      );
    }

    // 5) Guardamos en Blob el PNG resultante
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
