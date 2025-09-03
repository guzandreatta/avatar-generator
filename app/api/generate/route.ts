import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

const NEGATIVE = [
  'text, watermark, logo, signature, multiple heads, extra arms, extra fingers, bad anatomy,',
  'blurry, noisy, pixelated, lowres, artifacts, distorted, deformed, oversharp,',
  'hands, full body, cropped head, background clutter'
].join(' ');

async function callReplicate(input: any) {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-1.1-pro'; // placeholder: set your model
  if (!token) throw new Error('Missing REPLICATE_API_TOKEN');

  // Kick off prediction
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // Replace with a model that supports image-to-image with identity+style (e.g., InstantID + IP-Adapter pipeline on SDXL/FLUX)
      // You can also set a specific version if needed.
      model,
      input
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate error: ${err}`);
  }
  const prediction = await res.json();

  // Poll until done
  let status = prediction.status;
  let output = prediction.output;
  let id = prediction.id;
  const POLL_URL = `https://api.replicate.com/v1/predictions/${id}`;

  while (status === 'starting' || status === 'processing') {
    await new Promise(r => setTimeout(r, 1500));
    const r2 = await fetch(POLL_URL, {
      headers: { 'Authorization': `Token ${token}` }
    });
    const j2 = await r2.json();
    status = j2.status;
    output = j2.output;
    if (status === 'failed' || status === 'canceled') {
      throw new Error('Prediction failed');
    }
  }

  // Many models return an array of image URLs as output
  const url = Array.isArray(output) ? output[0] : (typeof output === 'string' ? output : null);
  if (!url) throw new Error('Model returned no image URL');
  return url;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const name = String(form.get('name') || 'Usuario');
    const prompt = String(form.get('prompt') || '');
    const styleUrl = String(form.get('styleUrl') || '');
    const photo = form.get('photo');

    if (!photo || !(photo instanceof File)) {
      return new NextResponse('Missing user photo', { status: 400 });
    }
    if (!styleUrl) {
      return new NextResponse('Missing styleUrl', { status: 400 });
    }

    // Upload user photo to Blob to get a public URL for the model
    const filename = `inputs/${Date.now()}-${photo.name}`;
    const uploaded = await put(filename, photo, { access: 'public' });

    // Build a consistent prompt template
    const fullPrompt = [
      `${prompt}`,
      `portrait avatar of ${name}, centered, front-facing, neutral background, high quality, consistent stylization`
    ].join(', ');

    // Input shape varies per model! Adjust keys to match your chosen model.
    // Common patterns: { image, style_image, prompt, negative_prompt }
    const input = {
      image: uploaded.url,
      style_image: styleUrl,
      prompt: fullPrompt,
      negative_prompt: NEGATIVE,
      // You may expose some params via env or request:
      num_inference_steps: 28,
      guidance_scale: 4.5,
      strength: 0.85,
      // Some models accept a face guidance image/embedding (e.g. InstantID);
      // If your chosen model requires it, you can pass the same user photo as 'face_image'.
      // face_image: uploaded.url
    };

    const generatedUrl = await callReplicate(input);

    // Optionally re-host the output to Blob (keeps a permanent copy under your bucket)
    const imgRes = await fetch(generatedUrl);
    if (!imgRes.ok) throw new Error('Could not fetch model output');
    const buffer = await imgRes.arrayBuffer();
    const outName = `outputs/${Date.now()}-avatar.jpg`;
    const saved = await put(outName, new Blob([buffer], { type: 'image/jpeg' }), { access: 'public' });

    return NextResponse.json({ outputUrl: saved.url });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message || 'Server error', { status: 500 });
  }
}
