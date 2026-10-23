import { useState } from "react";
import "./App.css";
import FenceMap from "./views/FenceMap";
import Verdicts from "./views/Verdicts";
import Overrides from "./views/Overrides";
import Stats from "./views/Stats";

const TABS = ["Fence Map", "Verdicts", "Overrides", "Stats"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_REPO = "acme/storefront";

export default function App() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [tab, setTab] = useState<Tab>("Fence Map");

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Chesterton — Fence Dashboard</h1>
        <label className="repo-selector">
          repo
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            aria-label="repo"
            spellCheck={false}
          />
        </label>
      </header>

      <nav className="tab-bar" role="tablist" aria-label="Dashboard views">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === "Fence Map" && <FenceMap repo={repo} />}
        {tab === "Verdicts" && <Verdicts repo={repo} />}
        {tab === "Overrides" && <Overrides repo={repo} />}
        {tab === "Stats" && <Stats repo={repo} />}
      </main>
    </div>
  );
}
