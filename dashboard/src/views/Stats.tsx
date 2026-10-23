import { useEffect, useState } from "react";
import { getStats } from "../api";
import type { Stats as StatsShape } from "../types";

export default function Stats({ repo }: { repo: string }) {
  const [stats, setStats] = useState<StatsShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    getStats(repo)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (error) return <p className="error-note">Failed to load stats: {error}</p>;
  if (!stats) return <p className="status-note">Loading stats…</p>;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const tiles: { label: string; value: string }[] = [
    { label: "Verdicts", value: String(stats.verdicts_total) },
    { label: "Flags", value: String(stats.flags_total) },
    { label: "Overrides", value: String(stats.overrides_total) },
    { label: "False positive rate", value: pct(stats.false_positive_rate) },
  ];

  return (
    <div className="stats-grid" data-testid="stats-grid">
      {tiles.map((t) => (
        <div className="stat-tile" key={t.label}>
          <div className="stat-value">{t.value}</div>
          <div className="stat-label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
