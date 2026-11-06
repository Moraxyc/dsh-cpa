import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  external: [
    'react',
    'react-dom',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  logLevel: 'info',
  legalComments: 'none',
  treeShaking: true,
})
