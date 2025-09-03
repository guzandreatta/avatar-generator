import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

const CF_ENDPOINT = (account: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`;

export const runtime = 'nodejs'; // nos aseguramos de tener Buffer/ArrayBuffer

type GenerateBody = {
  name?: string;            // opcional: nombre para el prompt
  imageUrl: string;         // URL pública de la foto subida (Vercel Blob)
  strength?: number;        // 0..1 (menor = más parecido a la foto)
  guidance?: number;        // 1..20 aprox.
  steps?: number;           // Cloudflare limita a 20 en este modelo
  width?: number;           // 256..2048
  height?: number;          // 256..2048
};

async function urlToBase64(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo leer la imagen source: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  // Base64 sin prefijo data:
  const b64 = Buffer.from(arrayBuffer).toString('base64');
  return { b64, arrayBuffer };
}

export async function POST(req: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Falta imageUrl' }, { status: 400 });
    }

    const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
    const CF_API_TOKEN = process.env.CF_API_TOKEN!;
    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN!;

    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
      return NextResponse.json(
        { error: 'Falta CF_ACCOUNT_ID o CF_API_TOKEN en variables de entorno' },
        { status: 500 }
      );
    }
    if (!BLOB_TOKEN) {
      return NextResponse.json(
        { error: 'Falta BLOB_READ_WRITE_TOKEN en variables de entorno' },
        { status: 500 }
      );
    }

    // 1) Cargar la foto del usuario y convertir a base64 para el endpoint img2img
    const { b64: sourceB64 } = await urlToBase64(imageUrl);

    // 2) Prompt simple (dejamos el “estilo” a cargo del modelo)
    const prompt =
      `Stylized avatar portrait of the person in the photo, centered head-and-shoulders, clean background, ` +
      `coherent colors, professional avatar, high detail. ${name ? `Name: ${name}.` : ''}`;

    // 3) Llamar al modelo de Cloudflare (devuelve imagen binaria)
    const cfRes = await fetch(CF_ENDPOINT(CF_ACCOUNT_ID), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_b64: sourceB64,
        strength,         // 0..1 (0.4–0.6 suele conservar identidad)
        guidance,         // ~7.5 por defecto
        num_steps: Math.min(steps, 20),
        width,
        height,
      }),
    });

    if (!cfRes.ok) {
      const text = await cfRes.text().catch(() => '');
      return NextResponse.json(
        { error: `Cloudflare AI error ${cfRes.status}`, detail: text },
        { status: 500 }
      );
    }

    const resultArrayBuffer = await cfRes.arrayBuffer();

    // 4) Guardar en Vercel Blob
    const fileName = `avatars/${Date.now()}.png`;
    const { url } = await put(fileName, resultArrayBuffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'image/png',
    });

    // 5) Responder con la URL pública del avatar generado
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Fallo al generar avatar', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
