// Bundles the keeper into one ESM file so the VPS only needs node, no node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log("dist/main.mjs");
