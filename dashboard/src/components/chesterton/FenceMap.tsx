import { useEffect, useMemo, useRef, useState } from "react";
import { api, fixtures, type FileFences } from "@/lib/api";
import { middleTruncate, rampStep, RAMP_STEPS, squarify } from "@/lib/treemap";
import { Citations, Empty, useLoad, type Load } from "./shared";

const GAP = 2;

export function FenceMap({ gw, repo, files }: { gw: string; repo: string; files: Load<FileFences[]> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ f: FileFences; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { const e = es[0]; if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const data = files.data ?? [];
  const max = Math.max(0, ...data.map((d) => d.fence_count));
  const tiles = useMemo(
    () => squarify(data.map((f) => ({ item: f, value: Math.max(f.loc, 1) })), { x: 0, y: 0, w: size.w, h: size.h }),
    [data, size],
  );

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="label-mono text-muted-foreground">Tile area is lines of code. Stronger teal carries more recorded decisions.</p>
          <Legend />
        </div>
        <div ref={ref} className="relative h-[560px] w-full" onMouseLeave={() => setHover(null)}>
          {files.loading && !files.data && <div className="skeleton absolute inset-0" />}
          {!files.loading && data.length === 0 && <Empty>No fences recorded for {repo} yet.</Empty>}
          {tiles.map((t) => {
            const step = rampStep(t.item.fence_count, max);
            const w = t.w - GAP, h = t.h - GAP;
            const fits = w > 60 && h > 32;
            const isSel = selected === t.item.file;
            return (
              <button
                key={t.item.file}
                type="button"
                aria-label={`${t.item.file}, ${t.item.fence_count} fences, ${t.item.loc} lines`}
                onClick={() => setSelected(t.item.file)}
                onMouseMove={(e) => {
                  const r = ref.current!.getBoundingClientRect();
                  setHover({ f: t.item, x: e.clientX - r.left, y: e.clientY - r.top });
                }}
                className={`tile-sheen absolute flex flex-col items-start justify-start overflow-hidden rounded-sm border p-2 text-left transition-colors duration-150 hover:border-border-strong ${isSel ? "border-border-strong" : "border-transparent"}`}
                style={{ left: t.x, top: t.y, width: Math.max(w, 0), height: Math.max(h, 0), background: `var(--ramp-${step})`, color: `var(--ramp-${step}-fg)` }}
              >
                {fits && (
                  <>
                    <span className="block whitespace-nowrap font-mono text-xs leading-tight">{middleTruncate(t.item.file, Math.floor((w - 16) / 7))}</span>
                    {h > 52 && <span className="mt-1 block text-xs tabular-nums opacity-80">{t.item.fence_count} fences</span>}
                  </>
                )}
              </button>
            );
          })}
          {hover && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 max-w-xs pill rounded-lg px-3 py-2 text-xs"
              style={{ left: Math.min(hover.x + 14, size.w - 240), top: hover.y + 14 }}
            >
              <div className="break-all font-mono text-foreground">{hover.f.file}</div>
              <div className="mt-1 tabular-nums text-muted-foreground">{hover.f.fence_count} fences · {hover.f.loc} loc</div>
            </div>
          )}
        </div>
      </div>
      {selected && <FencePanel gw={gw} repo={repo} file={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="label-mono flex shrink-0 items-center gap-2 text-muted-foreground">
      <span>fewer fences</span>
      <div className="flex">
        {Array.from({ length: RAMP_STEPS }, (_, i) => (
          <span key={i} className="h-3 w-4 first:rounded-l-sm last:rounded-r-sm" style={{ background: `var(--ramp-${i})` }} />
        ))}
      </div>
      <span>more fences</span>
    </div>
  );
}

function FencePanel({ gw, repo, file, onClose }: { gw: string; repo: string; file: string; onClose: () => void }) {
  const d = useLoad(() => api.decisions(gw, repo, file), () => fixtures.decisions(file), [gw, repo, file]);
  return (
    <aside className="w-[380px] shrink-0 animate-in slide-in-from-right-2 duration-150 border-l pl-6" aria-label="File fences">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-mono text-brand">[ Fences in ]</p>
          <h2 className="mt-1 break-all font-mono text-sm">{file}</h2>
        </div>
        <button onClick={onClose} aria-label="Close panel" className="rounded-sm px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">✕</button>
      </div>
      <div className="mt-6 space-y-6">
        {d.loading && !d.data && [0, 1].map((i) => <div key={i} className="skeleton h-24" />)}
        {d.data?.length === 0 && <p className="text-sm text-muted-foreground">No recorded decisions for this file.</p>}
        {d.data?.map((f) => (
          <article key={f.id} className="space-y-2 border-b pb-6 last:border-0">
            <span className="inline-block rounded-sm bg-brand-surface px-1.5 py-0.5 font-mono text-xs tabular-nums">L{f.line_start}–{f.line_end}</span>
            <p className="text-sm leading-relaxed">{f.summary}</p>
            <Citations list={f.citations} />
          </article>
        ))}
      </div>
    </aside>
  );
}
