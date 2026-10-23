import { useEffect, useState } from "react";
import { getVerdicts } from "../api";
import type { Flag } from "../types";

export default function Verdicts({ repo }: { repo: string }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFlags(null);
    setError(null);
    getVerdicts(repo)
      .then((f) => {
        if (!cancelled) setFlags(f);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (error) return <p className="error-note">Failed to load verdicts: {error}</p>;
  if (!flags) return <p className="status-note">Loading verdicts…</p>;
  if (flags.length === 0) return <p className="status-note">No flags for {repo}.</p>;

  return (
    <table className="data-table" data-testid="verdicts-table">
      <thead>
        <tr>
          <th>File</th>
          <th>Line</th>
          <th>Kind</th>
          <th>Verdict</th>
          <th>Reason</th>
          <th>Citations</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {flags.map((flag) => (
          <tr key={flag.id}>
            <td>{flag.file}</td>
            <td>{flag.line}</td>
            <td>{flag.kind}</td>
            <td>
              <span className="badge">{flag.verdict}</span>
            </td>
            <td>{flag.reason}</td>
            <td>
              <ul className="citation-list">
                {flag.citations.map((c, i) => (
                  <li key={i}>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.title}
                    </a>
                  </li>
                ))}
              </ul>
            </td>
            <td>
              <span className="badge">{flag.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
