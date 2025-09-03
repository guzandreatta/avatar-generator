'use client';

import { useState } from 'react';

export default function HomePage() {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('clean studio avatar, symmetrical face, plain background, upper body, vibrant yet soft colors');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultUrl(null);
    if (!photo) { setError('Subí una foto.'); return; }

    const form = new FormData();
    form.append('name', name || 'Usuario');
    form.append('photo', photo);
    form.append('prompt', prompt);

    setLoading(true);
    const res = await fetch('/api/generate', { method: 'POST', body: form });
    setLoading(false);
    if (!res.ok) {
      const t = await res.text();
      setError(`Error: ${t}`);
      return;
    }
    const data = await res.json();
    setResultUrl(data.outputUrl);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Generador de Avatars</h1>
      <p className="text-[var(--muted)]">
        Subí tu foto, pegá el <b>Style URL</b> que te pasa el admin y generá tu avatar.
      </p>

      <form onSubmit={onSubmit} className="card space-y-4">
        <div>
          <label className="label">Tu nombre (para el prompt)</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Gumo" />
        </div>

        <div>
          <label className="label">Tu foto (frontal, buena luz)</label>
          <input className="file" type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
        </div>

        <div>
          <label className="label">Prompt base (admin puede definir uno mejor)</label>
          <input className="input" value={prompt} onChange={e => setPrompt(e.target.value)} />
        </div>

        <button className="btn" disabled={loading}>{loading ? 'Generando...' : 'Generar avatar'}</button>
      </form>

      {error && <div className="card border border-red-500/40 text-red-300">{error}</div>}
      {resultUrl && (
        <div className="card">
          <p className="mb-3 text-[var(--muted)]">Resultado</p>
          <img src={resultUrl} alt="avatar result" className="rounded-xl w-full" />
        </div>
      )}
    </div>
  );
}
