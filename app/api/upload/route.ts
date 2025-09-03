// app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return new NextResponse('Missing BLOB_READ_WRITE_TOKEN', { status: 500 });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return new NextResponse('Missing file', { status: 400 });
    }
    const name = `uploads/${Date.now()}-${(file as File).name}`;
    const saved = await put(name, file as File, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return NextResponse.json({ url: saved.url });
  } catch (e: any) {
    return new NextResponse(e?.message || 'Upload error', { status: 500 });
  }
}
