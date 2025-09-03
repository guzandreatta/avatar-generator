import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('style');
  if (!file || !(file instanceof File)) {
    return new NextResponse('Missing style file', { status: 400 });
  }
  const filename = `styles/${Date.now()}-${file.name}`;
  const blob = await put(filename, file, { access: 'public' });
  return NextResponse.json({ url: blob.url });
}
