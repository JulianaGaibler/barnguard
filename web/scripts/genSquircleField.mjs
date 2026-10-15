// Builds the smooth-corner distance field the shape program samples, from the
// same corner math the engine draws outlines with, and writes it next to the
// module that loads it. See render/gfx/squircleField.ts.
//
// Usage: npm run gen:squircle

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const out = fileURLToPath(
  new URL('../src/stargazer/render/gfx/squircleField.bin', import.meta.url),
)

// Vite loads the TypeScript module with the project's aliases and resolution.
const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { middlewareMode: true, hmr: false },
  // Only one module is loaded, so there is nothing to pre-bundle.
  optimizeDeps: { noDiscovery: true, entries: [] },
  appType: 'custom',
  logLevel: 'error',
})
try {
  const field = await server.ssrLoadModule(
    '/src/stargazer/render/gfx/squircleField.ts',
  )
  const started = performance.now()
  const data = field.buildField()
  writeFileSync(
    out,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  )
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(
    `squircleField.bin: ${field.FIELD_TILE_COUNT} tiles of ${field.FIELD_TILE_SIZE}x${field.FIELD_TILE_SIZE}, ${data.byteLength} bytes, ${seconds} s`,
  )
} finally {
  await server.close()
}
