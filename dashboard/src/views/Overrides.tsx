import { useEffect, useState } from "react";
import { getOverrides } from "../api";
import type { OverrideRow } from "../types";

export default function Overrides({ repo }: { repo: string }) {
  const [rows, setRows] = useState<OverrideRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    getOverrides(repo)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (error) return <p className="error-note">Failed to load overrides: {error}</p>;
  if (!rows) return <p className="status-note">Loading overrides…</p>;
  if (rows.length === 0) return <p className="status-note">No overrides for {repo}.</p>;

  return (
    <table className="data-table" data-testid="overrides-table">
      <thead>
        <tr>
          <th>Verdict ID</th>
          <th>File</th>
          <th>Reason</th>
          <th>Author</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.verdict_id}</td>
            <td>{row.verdict?.payload?.file ?? row.verdict?.file ?? "—"}</td>
            <td>{row.reason}</td>
            <td>{row.author}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
