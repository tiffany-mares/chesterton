import fs from "node:fs";
import path from "node:path";
import type { Knowledge, SlackData, LinearData, PrsData } from "./types.js";

export interface Fixtures {
  knowledge: Knowledge;
  slack: SlackData;
  linear: LinearData;
  prs: PrsData;
  /** Directory fixture-relative paths (e.g. a PR's diff_file) are resolved against. */
  seedOutDir: string;
}

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export interface LoadFixturesOptions {
  seedOutDir: string;
  knowledgeFile?: string;
}

/**
 * Loads the four fixture files produced by seed/seed.py.
 * `knowledgeFile` (or env `KNOWLEDGE_FILE`) overrides the knowledge.json path;
 * everything else is resolved relative to `seedOutDir`.
 */
export function loadFixtures(opts: LoadFixturesOptions): Fixtures {
  const { seedOutDir } = opts;
  const knowledgePath = opts.knowledgeFile ?? path.join(seedOutDir, "knowledge.json");

  return {
    knowledge: readJson<Knowledge>(knowledgePath),
    slack: readJson<SlackData>(path.join(seedOutDir, "slack.json")),
    linear: readJson<LinearData>(path.join(seedOutDir, "linear.json")),
    prs: readJson<PrsData>(path.join(seedOutDir, "prs.json")),
    seedOutDir,
  };
}

/** Resolves a PR's diff_file path against the fixtures' seedOutDir and reads it. */
export function readPrDiff(fixtures: Fixtures, diffFile: string): string {
  return fs.readFileSync(path.join(fixtures.seedOutDir, diffFile), "utf8");
}
