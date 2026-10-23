import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const outdir = path.resolve("dist");

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ["src/content.ts", "src/options.ts"],
  bundle: true,
  outdir,
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
});

cpSync("manifest.json", path.join(outdir, "manifest.json"));
cpSync("options.html", path.join(outdir, "options.html"));

console.log(`Build complete: ${outdir}`);
