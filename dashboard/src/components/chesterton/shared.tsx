import { useEffect, useRef, useState } from "react";
import type { Citation, Flag } from "@/lib/api";

const glyph: Record<Citation["type"], string> = { slack: "#", linear: "◇", pr: "⑂", override: "↺" };
const label: Record<Citation["type"], string> = { slack: "Slack", linear: "Linear", pr: "PR", override: "Override" };

export function CitationChip({ c }: { c: Citation }) {
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      title={c.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-foreground transition-colors duration-150 hover:border-brand"
    >
      <span aria-hidden className="font-mono text-muted-foreground">{glyph[c.type]}</span>
      <span className="font-medium">{label[c.type]}</span>
      <span className="truncate text-muted-foreground">{c.title}</span>
    </a>
  );
}

export function Citations({ list }: { list: Citation[] }) {
  return <div className="flex flex-wrap gap-1.5">{list.map((c, i) => <CitationChip key={i} c={c} />)}</div>;
}

const statusDot: Record<Flag["status"], string> = { open: "bg-warn", dismissed: "bg-neutral-dot", overridden: "bg-override" };
const statusText: Record<Flag["status"], string> = { open: "Open", dismissed: "Dismissed", overridden: "Overridden" };
export function StatusLabel({ s }: { s: Flag["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span aria-hidden className={`size-2 rounded-full ${statusDot[s]}`} />
      {statusText[s]}
    </span>
  );
}

export function KindBadge({ k }: { k: Flag["kind"] }) {
  return (
    <span className="label-mono inline-flex whitespace-nowrap rounded-full border px-2 py-0.5">
      {k === "contradiction" ? "Contradiction" : "Stale comment"}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-6 py-16 text-center">
      <p className="text-sm text-foreground">{children}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tip: run the seed script against the gateway to populate sample data.
      </p>
    </div>
  );
}

export type Load<T> = { data: T | null; loading: boolean; error: string | null; fallback: boolean };

/** Fetch with last-good-data retention and fixture fallback when nothing has loaded yet. */
export function useLoad<T>(fn: () => Promise<T>, fixture: () => T, deps: unknown[]): Load<T> {
  const [state, set] = useState<Load<T>>({ data: null, loading: true, error: null, fallback: false });
  const last = useRef<T | null>(null);
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true }));
    fn()
      .then((d) => { if (!alive) return; last.current = d; set({ data: d, loading: false, error: null, fallback: false }); })
      .catch((e: Error) => {
        if (!alive) return;
        const keep = last.current;
        set({ data: keep ?? fixture(), loading: false, error: e.message, fallback: keep === null });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [3600, "minute"], [86400, "hour"], [2592000, "day"], [31536000, "month"]];
  if (diff < 60) return rtf.format(-Math.round(diff), "second");
  for (let i = 1; i < steps.length; i++) { const [lim, unit] = steps[i]!; if (diff < lim) return rtf.format(-Math.round(diff / steps[i - 1]![0]), unit); }
  return rtf.format(-Math.round(diff / 31536000), "year");
}

export function fmtRate(flags: number, rate: number) {
  return flags === 0 ? "—" : `${(rate * 100).toFixed(1)}%`;
}
