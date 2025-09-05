'use client';

import { useState, useRef } from 'react';

export default function HomePage() {
  const [photo, setPhoto] = useState<File | null>(null);

  // Nuevo: campos para modelo y prompt
  const [model, setModel] = useState<string>('flux-kontext-apps/cartoonify');
  const [prompt, setPrompt] = useState<string>('Make this a 90s cartoon');

  // Parámetros opcionales (pueden ser ignorados según el modelo)
  const [strength, setStrength] = useState<number | ''>('');
  const [width, setWidth] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [seed, setSeed] = useState<number | ''>('');

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showLogs, setShowLogs] = useState(true);
  const [logs, setLogs] = useState<string>('');
  const logBoxRef = useRef<HTMLTextAreaElement>(null);

  function appendLog(line: string) {
    setLogs((prev) => {
      const next = prev ? prev + '\n' + line : line;
      queueMicrotask(() => {
        const el = logBoxRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return next;
    });
  }

  async function uploadToBlob(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const up = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!up.ok) throw new Error(await up.text());
    const { url } = await up.json();
    return url as string;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResultUrl(null);
    setLogs('');

    if (!photo) {
      setError('Subí una foto (frontal, con buena luz).');
      return;
    }

    try {
      setLoading(true);

      appendLog('subiendo imagen…');
      const imageUrl = await uploadToBlob(photo);
      appendLog(`imageUrl: ${imageUrl}`);

      const payload: any = { imageUrl, model, prompt };
      if (strength !== '') payload.strength = Number(strength);
      if (width !== '') payload.width = Number(width);
      if (height !== '') payload.height = Number(height);
      if (seed !== '') payload.seed = Number(seed);

      appendLog(`iniciando generación en Replicate…`);
      const res = await fetch('/api/generate?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Fallo inicial: ${t}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No se pudo abrir el stream de logs');

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          appendLog(trimmed);
          if (trimmed.startsWith('RESULT:')) {
            const url = trimmed.replace('RESULT:', '').trim();
            setResultUrl(url);
          }
          if (trimmed.startsWith('ERROR:')) {
            setError(trimmed.replace('ERROR:', '').trim());
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setPhoto(null);
    setModel('flux-kontext-apps/cartoonify');
    setPrompt('Make this a 90s cartoon');
    setStrength('');
    setWidth('');
    setHeight('');
    setSeed('');
    setResultUrl(null);
    setError(null);
    setLogs('');
  }

  const isCartoonify = /flux[-_.]?kontext[-_.]?apps\/cartoonify/i.test(model);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Generador de Avatars (Replicate)</h1>
      <p className="text-[var(--muted)]">
        Elegí el modelo y el prompt. Tip: <code>flux-kontext-apps/cartoonify</code> ignora el prompt y usa sólo <code>input_image</code>.
      </p>

      <form onSubmit={onSubmit} className="card space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Modelo de Replicate</label>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="owner/name o owner/name:version o version_id"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Ej: <code>flux-kontext-apps/cartoonify</code> o <code>black-forest-labs/flux-kontext-pro</code>
            </p>
          </div>
          <div>
            <label className="label">Prompt</label>
            <input
              className="input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Make this a 90s cartoon"
              disabled={isCartoonify}
            />
            {isCartoonify && (
              <p className="text-xs text-[var(--muted)] mt-1">
                Este modelo no usa prompt; se ignora.
              </p>
            )}
          </div>
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

        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="label">Strength (opcional)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              placeholder="ej: 0.8"
              value={strength}
              onChange={(e) => setStrength(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Algunos modelos la ignoran (p. ej., cartoonify).
            </p>
          </div>
          <div>
            <label className="label">Ancho (px)</label>
            <input
              type="number"
              className="input"
              min={256}
              max={2048}
              step={64}
              placeholder="ej: 1024"
              value={width}
              onChange={(e) => setWidth(e.target.value === '' ? '' : Number(e.target.value))}
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
              placeholder="ej: 1024"
              value={height}
              onChange={(e) => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Seed (opcional)</label>
            <input
              type="number"
              className="input"
              placeholder="fijá un seed para repetibilidad"
              value={seed}
              onChange={(e) => setSeed(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input id="showlogs" type="checkbox" checked={showLogs} onChange={(e) => setShowLogs(e.target.checked)} />
            <label htmlFor="showlogs" className="label">Ver logs en vivo</label>
          </div>
          <div className="flex gap-3">
            <button className="btn" disabled={loading}>
              {loading ? 'Generando…' : 'Generar avatar'}
            </button>
            <button type="button" className="btn" onClick={resetForm} disabled={loading}>
              Reset
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="card border border-red-500/40 text-red-300">
          <p className="font-medium">Error</p>
          <p className="opacity-90 mt-1">{error}</p>
        </div>
      )}

      {showLogs && (
        <div className="card">
          <p className="mb-2 text-[var(--muted)]">Logs</p>
          <textarea
            ref={logBoxRef}
            className="input"
            style={{ minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
            readOnly
            value={logs}
          />
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
            <button className="btn" onClick={() => navigator.clipboard?.writeText(resultUrl)}>
              Copiar URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
