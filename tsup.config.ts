import { defineConfig } from 'tsup';

// One entry point, two module formats: ESM (`dist/index.js`) for modern
// bundlers/Node, CJS (`dist/index.cjs`) for a `require()` consumer. `dts:
// true` runs once and emits `.d.ts` for both (tsup reuses the same
// declaration output). `src/generated/*` must exist before this runs — see
// the `prebuild` script in package.json.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'es2021',
  dts: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
});
