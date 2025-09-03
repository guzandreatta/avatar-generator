'use client';

import { useState } from 'react';

export default function HomePage() {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);

  // Parámetros de estilo
  const [strength, setStrength] = useState<number>(0.8);   // 0..1 (0.75–0.9 => dibujo fuerte)
  const [bgColor, setBgColor] = useState<string>('teal');  // fondo sólido
  const [darkHumor, setDarkHumor] = useState<boolean>(false); // salpicado rojo estilizado opcional

  const [width, setWidth] = useState<number>(1024);
  const [height, setHeight] = useState<number>(1024);

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function uploadToBlob(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const up = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!up.ok) throw new Error(await up.text());
    const { url } = await up.json();
    return url as string;
  }

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

      // 1) Subimos la foto a Blob -> imageUrl público
      const imageUrl = await uploadToBlob(photo);

      // 2) Generamos avatar con estilo "dibujo"
      const gen = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Usuario',
          imageUrl,
          strength,
          width,
          height,
          darkHumor,
          bgColor
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
    setStrength(0.8);
    setBgColor('teal');
    setDarkHumor(false);
    setWidth(1024);
    setHeight(1024);
    setResultUrl(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Generador de Avatars (Estilo Dibujo)</h1>
      <p className="text-[var(--muted)]">
        Subí tu foto y generá un avatar con contornos gruesos, colores planos y fondo sólido.
      </p>

      <form onSubmit={onSubmit} className="card space-y-5">
        <div>
          <label className="label">Tu nombre (opcional, influye el prompt)</label>
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

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="label">Fondo (color)</label>
            <input
              className="input"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              placeholder="Ej: teal, #00b3b3, orange..."
            />
          </div>
          <div>
            <label className="label">Modo “dark humor”</label>
            <div className="flex items-center gap-3">
              <input
                id="darkhumor"
                type="checkbox"
                checked={darkHumor}
                onChange={(e) => setDarkHumor(e.target.checked)}
              />
              <label htmlFor="darkhumor" className="text-sm">
                Salpicado rojo estilizado (no realista)
              </label>
            </div>
          </div>
          <div>
            <label className="label">Fuerza de estilización</label>
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
              {strength.toFixed(2)} — mayor = más “dibujo” (menos parecido a la foto)
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="label">Resolución</span>
          <button
            type="button"
            className="btn"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? 'Ocultar' : 'Avanzado'}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid md:grid-cols-2 gap-4">
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
          <img src={resultUrl} alt="avatar result" className="rounded-xl w-full" />
          <div className="mt-4 flex gap-3">
            <a className="btn" href={resultUrl} download>
              Descargar PNG
            </a>
            <button
              className="btn"
              onClick={() => navigator.clipboard?.writeText(resultUrl)}
            >
              Copiar URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
