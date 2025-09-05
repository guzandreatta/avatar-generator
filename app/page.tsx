'use client';

import { useState, useRef } from 'react';

export default function HomePage() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [strength, setStrength] = useState<number | ''>('');
  const [width, setWidth] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showLogs, setShowLogs] = useState(true);
  const [logs, setLogs] = useState<string>('');
  const logBoxRef = useRef<HTMLTextAreaElement>(null);

  function appendLog(line: string) {
    setLogs((prev) => {
      const next = prev ? prev + '\n' + line : line;
      // auto-scroll
      queueMicrotask(() => {
        const el = logBoxRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
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

      // 1) Subimos la foto a Blob -> imageUrl público
      appendLog('subiendo imagen…');
      const imageUrl = await uploadToBlob(photo);
      appendLog(`imageUrl: ${imageUrl}`);

      // 2) Generamos con streaming de logs
      const payload: any = { imageUrl };
      if (strength !== '') payload.strength = Number(strength);
      if (width !== '') payload.width = Number(width);
      if (height !== '') payload.height = Number(height);

      appendLog('iniciando generación en Replicate…');
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
      if (!reader) {
        throw new Error('No se pudo abrir el stream de logs');
      }

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Separamos por líneas
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // dejamos la última incompleta en buffer

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
    setStrength('');
    setWidth('');
    setHeight('');
    setResultUrl(null);
    setError(null);
    setLogs('');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Generador de Avatars (con logs)</h1>
      <p className="text-[var(--muted)]">
        El backend usa un prompt fijo: <code>Make this a 90s cartoon</code>. Ahora ves el progreso en vivo.
      </p>

      <form onSubmit={onSubmit} className="card space-y-5">
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
          </div>
          <div>
            <label className="label">Ancho (px, opcional)</label>
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
            <label className="label">Alto (px, opcional)</label>
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
