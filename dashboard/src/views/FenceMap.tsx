import { useEffect, useState } from "react";
import { getDecisions, getFencesByFile } from "../api";
import { layoutTreemap } from "../treemap";
import type { Decision, FenceByFileRow } from "../types";
import "./FenceMap.css";

const WIDTH = 960;
const HEIGHT = 480;

export default function FenceMap({ repo }: { repo: string }) {
  const [fences, setFences] = useState<FenceByFileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFences(null);
    setError(null);
    setSelectedFile(null);
    getFencesByFile(repo)
      .then((rows) => {
        if (!cancelled) setFences(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (error) return <p className="error-note">Failed to load fence map: {error}</p>;
  if (!fences) return <p className="status-note">Loading fence map…</p>;
  if (fences.length === 0) return <p className="status-note">No fenced files for {repo}.</p>;

  const rects = layoutTreemap(fences, WIDTH, HEIGHT);

  return (
    <div className="fence-map">
      <div className="fence-map-canvas">
        <svg
          className="fence-map-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Fence map treemap"
        >
          {rects.map((r) => {
            const w = r.x1 - r.x0;
            const h = r.y1 - r.y0;
            const selected = r.file === selectedFile;
            return (
              <g
                key={r.file}
                className={`fence-tile${selected ? " is-selected" : ""}`}
                transform={`translate(${r.x0}, ${r.y0})`}
                onClick={() => setSelectedFile(r.file)}
                data-testid="fence-tile"
                data-file={r.file}
              >
                <rect width={w} height={h} fill={r.fill} />
                {w > 40 && h > 16 && (
                  <text x={4} y={4} fill={r.labelColor}>
                    {truncateLabel(r.file, w)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="fence-map-legend">
          <span>fewer fences</span>
          <span className="ramp" />
          <span>more fences</span>
        </div>
      </div>
      <SidePanel repo={repo} file={selectedFile} />
    </div>
  );
}

function truncateLabel(file: string, widthPx: number): string {
  const maxChars = Math.max(3, Math.floor(widthPx / 6.5));
  if (file.length <= maxChars) return file;
  return `…${file.slice(file.length - maxChars + 1)}`;
}

function SidePanel({ repo, file }: { repo: string; file: string | null }) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setDecisions(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDecisions(null);
    setError(null);
    getDecisions(repo, file)
      .then((rows) => {
        if (!cancelled) setDecisions(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo, file]);

  if (!file) {
    return (
      <aside className="side-panel" data-testid="side-panel">
        <p className="status-note">Click a tile to see that file&rsquo;s fences.</p>
      </aside>
    );
  }

  return (
    <aside className="side-panel" data-testid="side-panel">
      <h3>{file}</h3>
      {error && <p className="error-note">Failed to load fences: {error}</p>}
      {!error && !decisions && <p className="status-note">Loading fences…</p>}
      {decisions && decisions.length === 0 && (
        <p className="status-note">No recorded fences for this file.</p>
      )}
      {decisions &&
        decisions.map((d) => (
          <div className="fence-entry" key={d.id}>
            <p className="fence-summary">
              L{d.line_start}–{d.line_end}: {d.summary}
            </p>
            <ul className="citation-list">
              {d.citations.map((c, i) => (
                <li key={i}>
                  <a href={c.url} target="_blank" rel="noreferrer">
                    [{c.type}] {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </aside>
  );
}
