import { useMemo, useState } from "react";
import type { Flag, Override, Stats } from "@/lib/api";
import { Citations, Empty, fmtRate, KindBadge, relTime, StatusLabel, type Load } from "./shared";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="pill inline-flex p-1">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`label-mono rounded-full px-3 py-1.5 transition-colors duration-150 ${value === v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

type SortKey = "file" | "line" | "kind" | "verdict" | "status";

export function Verdicts({ flags }: { flags: Load<Flag[]> }) {
  const [kind, setKind] = useState<"all" | Flag["kind"]>("all");
  const [status, setStatus] = useState<"all" | Flag["status"]>("all");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "file", dir: 1 });
  const rows = useMemo(() => {
    const r = (flags.data ?? []).filter((f) => (kind === "all" || f.kind === kind) && (status === "all" || f.status === status));
    return [...r].sort((a, b) => (a[sort.k] < b[sort.k] ? -1 : a[sort.k] > b[sort.k] ? 1 : 0) * sort.dir);
  }, [flags.data, kind, status, sort]);

  const Th = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <th className={`py-2 pr-4 font-medium ${right ? "text-right" : "text-left"}`} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="hover:text-foreground" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))}>
        {children}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[["all", "All kinds"], ["contradiction", "Contradiction"], ["stale_comment", "Stale comment"]]} />
        <Segmented label="Status" value={status} onChange={setStatus} options={[["all", "All statuses"], ["open", "Open"], ["dismissed", "Dismissed"], ["overridden", "Overridden"]]} />
      </div>
      {flags.loading && !flags.data ? <div className="skeleton h-48" /> : rows.length === 0 ? (
        <Empty>No flags match. Chesterton hasn't tapped anyone on the shoulder here.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="label-mono border-b text-muted-foreground">
              <tr><Th k="file">File</Th><Th k="line" right>Line</Th><Th k="kind">Kind</Th><Th k="verdict">Verdict</Th>
                <th className="py-2 pr-4 text-left font-medium">Reason</th><th className="py-2 pr-4 text-left font-medium">Citations</th><Th k="status">Status</Th></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b align-top last:border-0">
                  <td className="py-3 pr-4 font-mono text-xs break-all">{f.file}</td>
                  <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{f.line}</td>
                  <td className="py-3 pr-4"><KindBadge k={f.kind} /></td>
                  <td className="py-3 pr-4 font-mono text-xs">{f.verdict}</td>
                  <td className="min-w-[280px] py-3 pr-4 leading-relaxed">{f.reason}</td>
                  <td className="max-w-[260px] py-3 pr-4"><Citations list={f.citations} /></td>
                  <td className="py-3"><StatusLabel s={f.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Overrides({ list }: { list: Load<Override[]> }) {
  const rows = [...(list.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (list.loading && !list.data) return <div className="space-y-4">{[0, 1].map((i) => <div key={i} className="skeleton h-32" />)}</div>;
  if (!rows.length) return <Empty>No overrides yet — when a reviewer overrides a flag with a reason, it becomes new memory and shows up here.</Empty>;
  return (
    <ol className="max-w-3xl space-y-8">
      {rows.map((o) => (
        <li key={o.id} className="border-l pl-6">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">{o.author}</span>
            <time dateTime={o.created_at} title={new Date(o.created_at).toLocaleString()} className="text-muted-foreground">{relTime(o.created_at)}</time>
          </div>
          <blockquote className="mt-2 border-l-2 border-brand pl-4 text-base leading-relaxed">“{o.reason}”</blockquote>
          <div className="mt-3 rounded-lg border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{o.verdict.file}:{o.verdict.line}</span>
              <KindBadge k={o.verdict.kind} />
            </div>
            <p className="mt-2 leading-relaxed text-muted-foreground">{o.verdict.reason}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function StatsView({ stats }: { stats: Load<Stats> }) {
  const s = stats.data;
  const tiles: [string, string, string][] = s ? [
    ["Verdicts", String(s.verdicts_total), "Pull-request hunks Chesterton checked against recorded fences."],
    ["Flags", String(s.flags_total), "Hunks that contradicted a decision or left a comment stale."],
    ["Overrides", String(s.overrides_total), "Flags a reviewer overrode with a reason, now part of memory."],
    ["False-positive rate", fmtRate(s.flags_total, s.false_positive_rate), "Share of flags reviewers dismissed or overrode."],
  ] : [];
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {!s ? [0, 1, 2, 3].map((i) => <div key={i} className="bg-background p-6"><div className="skeleton h-20" /></div>) :
        tiles.map(([l, v, d]) => (
          <div key={l} className="bg-background p-6">
            <p className="label-mono text-muted-foreground">[ {l} ]</p>
            <p className="mt-3 text-6xl font-semibold tabular-nums tracking-tight text-brand">{v}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{d}</p>
          </div>
        ))}
    </div>
  );
}
