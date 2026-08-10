import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  clean: false,
  dts: false,
  fixedExtension: true,
  deps: {
    // Peer dependencies are provided by the dsh profile at runtime.
    neverBundle: ['cordis', 'schemastery', '@deepseek-ai/dsh-tools'],
  },
})
