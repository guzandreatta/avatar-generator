'use client';

import { useState } from 'react';

export default function HomePage() {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);

  // Opciones de generación (puedes ocultarlas si querés dejar fijo)
  const [strength, setStrength] = useState<number>(0.5); // 0..1 (0.4–0.6 conserva identidad)
  const [width, setWidth] = useState<number>(1024);      // 256..2048
  const [height, setHeight] = useState<number>(1024);    // 256..2048

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultUrl(null);

    if (!photo) {
      setError('Subí una foto (frontal, con buena luz).');
      return;
    }

    try {
      setLoading(true);

      // 1) Subir la foto del usuario a Blob (endpoint interno)
      const form = new FormData();
      form.append('file', photo);
      const up = await fetch('/api/upload', { method: 'POST', body: form });
      if (!up.ok) {
        const t = await up.text();
        throw new Error(`Error al subir la imagen: ${t}`);
      }
      const { url: imageUrl } = await up.json();

      // 2) Generar avatar con Cloudflare Workers AI (endpoint interno)
      const gen = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Usuario',
          imageUrl,
          strength,
          width,
          height,
        }),
      });
      if (!gen.ok) {
        const t = await gen.text();
        throw new Error(`Error al generar el avatar: ${t}`);
      }
      const data = await gen.json(); // { url }
      setResultUrl(data.url);
    } catch (err: any) {
      setError(err?.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName('');
    setPhoto(null);
    setStrength(0.5);
    setWidth(1024);
    setHeight(1024);
    setResultUrl(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Generador de Avatars</h1>
      <p className="text-[var(--muted)]">
        Subí tu foto y generá un avatar con estilo consistente. El procesamiento corre en la nube.
      </p>

      <form onSubmit={onSubmit} className="card space-y-5">
        <div>
          <label className="label">Tu nombre (se usa en el prompt)</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Gumo"
          />
        </div>

        <div>
          <label className="label">Tu foto</label>
          <input
            className="file"
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          {photo && (
            <p className="text-xs text-[var(--muted)] mt-1">
              Archivo: <span className="opacity-80">{photo.name}</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="label">Opciones avanzadas</span>
          <button
            type="button"
            className="btn"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">Strength (0–1)</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-[var(--muted)] mt-1">
                {strength.toFixed(2)} — menor = más parecido a la foto
              </div>
            </div>
            <div>
              <label className="label">Ancho (px)</label>
              <input
                type="number"
                className="input"
                min={256}
                max={2048}
                step={64}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Alto (px)</label>
              <input
                type="number"
                className="input"
                min={256}
                max={2048}
                step={64}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button className="btn" disabled={loading}>
            {loading ? 'Generando…' : 'Generar avatar'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={resetForm}
            disabled={loading}
          >
            Reset
          </button>
        </div>
      </form>

      {error && (
        <div className="card border border-red-500/40 text-red-300">
          <p className="font-medium">Error</p>
          <p className="opacity-90 mt-1">{error}</p>
        </div>
      )}

      {resultUrl && (
        <div className="card">
          <p className="mb-3 text-[var(--muted)]">Resultado</p>
          {/* Podés usar next/image si preferís, pero <img> es más simple para cualquier origen */}
          <img
            src={resultUrl}
            alt="avatar result"
            className="rounded-xl w-full"
          />
          <div className="mt-4 flex gap-3">
            <a className="btn" href={resultUrl} download>
              Descargar PNG
            </a>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(resultUrl);
              }}
            >
              Copiar URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
