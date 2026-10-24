import { useEffect, useState } from "react";
import { api, DEFAULT_GATEWAY, fixtures } from "@/lib/api";
import { useLoad } from "@/components/chesterton/shared";
import { FenceMap } from "@/components/chesterton/FenceMap";
import { Overrides, StatsView, Verdicts } from "@/components/chesterton/Views";

const TABS = [["map", "Fence Map"], ["verdicts", "Verdicts"], ["overrides", "Overrides"], ["stats", "Stats"]] as const;
type Tab = (typeof TABS)[number][0];

type Theme = "system" | "light" | "dark";
const THEME_ORDER: Theme[] = ["system", "light", "dark"];
const THEME_GLYPH: Record<Theme, string> = { system: "◐ auto", light: "○ light", dark: "● dark" };

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("map");
  const [repo, setRepo] = useState("acme/storefront");
  const [repoDraft, setRepoDraft] = useState(repo);
  const [gw, setGw] = useState(DEFAULT_GATEWAY);
  const [gwDraft, setGwDraft] = useState(gw);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = localStorage.getItem("chesterton.gateway");
    if (saved) { setGw(saved); setGwDraft(saved); }
    const savedTheme = (localStorage.getItem("chesterton.theme") as Theme | null) ?? "system";
    setTheme(savedTheme);
    applyTheme(savedTheme);
    const sync = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some(([k]) => k === h)) setTab(h);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => theme === "system" && applyTheme("system");
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, [theme]);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
    setTheme(next);
    localStorage.setItem("chesterton.theme", next);
  };

  const files = useLoad(() => api.fencesByFile(gw, repo), fixtures.fencesByFile, [gw, repo]);
  const flags = useLoad(() => api.verdicts(gw, repo), fixtures.verdicts, [gw, repo]);
  const overrides = useLoad(() => api.overrides(gw, repo), fixtures.overrides, [gw, repo]);
  const stats = useLoad(() => api.stats(gw, repo), fixtures.stats, [gw, repo]);

  const errs = [files, flags, overrides, stats].filter((l) => l.error);
  const errKey = errs.map((e) => e.error).join("|");
  const usingFixtures = errs.some((e) => e.fallback);

  return (
    <div className="flex min-h-screen flex-col">
      <header>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-6 px-8 pb-8 pt-12">
          <div className="max-w-2xl">
            <p className="label-mono flex items-center gap-2 text-brand"><span aria-hidden className="size-1.5 rounded-full bg-brand" />[ Chesterton · Fence dashboard ]</p>
            <h1 className="mt-4 text-5xl font-semibold uppercase leading-[0.95] tracking-tight md:text-6xl">
              Mind the <span className="text-outline">fences.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Other tools tell you why the fence is there if you think to ask. Chesterton taps you on the shoulder before you tear it down.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Field label="Repo" value={repoDraft} onChange={setRepoDraft} onCommit={() => setRepo(repoDraft.trim() || repo)} />
            <Field label="Gateway" value={gwDraft} onChange={setGwDraft} onCommit={() => {
              const v = gwDraft.trim() || DEFAULT_GATEWAY; setGw(v); localStorage.setItem("chesterton.gateway", v);
            }} />
            <button onClick={cycleTheme} aria-label={`Theme: ${theme}`} title="Cycle theme"
              className="pill label-mono px-4 py-2 text-muted-foreground transition-colors duration-150 hover:border-brand hover:text-foreground">
              {THEME_GLYPH[theme]}
            </button>
          </div>
        </div>
        <nav className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur" aria-label="Views">
          <div className="mx-auto flex max-w-[1400px] gap-1 px-6">
            {TABS.map(([k, l]) => (
              <a key={k} href={`#${k}`} aria-current={tab === k ? "page" : undefined}
                className={`label-mono -mb-px border-b-2 px-3 py-3 transition-colors duration-150 ${tab === k ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {l}
              </a>
            ))}
          </div>
        </nav>
      </header>

      {errs.length > 0 && dismissed !== errKey && (
        <div role="alert" className="border-b bg-warn-surface">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-8 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full bg-warn" />
              <span className="label-mono text-warn">Offline</span> Gateway unreachable ({errs[0]?.error}). {usingFixtures ? "Showing sample data." : "Showing last good data."}
            </span>
            <button onClick={() => setDismissed(errKey)} className="label-mono rounded-full px-3 py-1 hover:bg-background/60">Dismiss</button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-8 py-8">
        {tab === "map" && <FenceMap gw={gw} repo={repo} files={files} />}
        {tab === "verdicts" && <Verdicts flags={flags} />}
        {tab === "overrides" && <Overrides list={overrides} />}
        {tab === "stats" && <StatsView stats={stats} />}
      </main>

      <footer className="border-t">
        <div className="label-mono mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-8 py-5 text-muted-foreground">
          <span>Chesterton — silence without evidence.</span>
          <span className="flex gap-4">
            <a className="transition-colors duration-150 hover:text-foreground" href="https://github.com/tiffany-mares/chesterton-app" target="_blank" rel="noreferrer">Source ↗</a>
            <a className="transition-colors duration-150 hover:text-foreground" href="https://github.com/tiffany-mares/chesterton-demo-storefront/pulls" target="_blank" rel="noreferrer">Demo PRs ↗</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (v: string) => void; onCommit: () => void }) {
  return (
    <label className="label-mono flex items-center gap-2 text-muted-foreground">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
        className="pill w-56 px-4 py-2 font-mono text-xs normal-case tracking-normal text-foreground hover:border-brand" />
    </label>
  );
}
