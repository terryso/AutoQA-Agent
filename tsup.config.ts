import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli/cli.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node\n',
  },
  outExtension() {
    return {
      js: '.js',
    }
  },
})
