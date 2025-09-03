'use client';

import { useState } from 'react';

export default function AdminPage() {
  const [styleFile, setStyleFile] = useState<File | null>(null);
  const [stylePrompt, setStylePrompt] = useState('');
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadStyle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStyleUrl(null);
    if (!styleFile) { setError('Subí una imagen de referencia.'); return; }

    const form = new FormData();
    form.append('style', styleFile);

    setLoading(true);
    const res = await fetch('/api/style', { method: 'POST', body: form });
    setLoading(false);
    if (!res.ok) {
      const t = await res.text();
      setError(t);
      return;
    }
    const data = await res.json();
    setStyleUrl(data.url);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Admin · Estilo del Avatar</h1>
      <p className="text-[var(--muted)]">
        Subí una imagen de <b>referencia de estilo</b>. Copiá el <b>Style URL</b> y compartilo con lxs usuarios.
      </p>

      <form onSubmit={uploadStyle} className="card space-y-4">
        <div>
          <label className="label">Imagen de referencia</label>
          <input className="file" type="file" accept="image/*" onChange={e => setStyleFile(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <label className="label">Prompt sugerido (opcional)</label>
          <input className="input" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)} placeholder="ej: 2D vector, líneas limpias, pastel" />
        </div>
        <button className="btn" disabled={loading}>{loading ? 'Subiendo...' : 'Subir estilo'}</button>
      </form>

      {error && <div className="card border border-red-500/40 text-red-300">{error}</div>}
      {styleUrl && (
        <div className="card">
          <p className="text-[var(--muted)]">Style URL (compartir a usuarios):</p>
          <code className="break-all">{styleUrl}</code>
          <div className="mt-3">
            <a className="btn" href={styleUrl} target="_blank">Ver imagen</a>
          </div>
        </div>
      )}
    </div>
  );
}
