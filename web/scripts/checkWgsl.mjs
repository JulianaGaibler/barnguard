// Compiles every WGSL file under src with Chrome's WGSL compiler
// (Tint) and prints its errors. Tint is stricter than naga and Firefox's
// compiler, so a file that passes here also passes there.
//
// Usage: npm run check:wgsl
// Set CHROME to the browser binary when it is not at the macOS default.

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const root = new URL('../src', import.meta.url).pathname
const chrome =
  process.env.CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9400 + Math.floor(Math.random() * 400)

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'site' || name === 'node_modules') continue
    if (statSync(path).isDirectory()) yield* walk(path)
    // Validate what WebGPU runs: a shader with includes runs its resolved
    // `.gen.wgsl`, and an include file is only a fragment.
    else if (
      name.endsWith('.wgsl') &&
      !name.endsWith('.inc.wgsl') &&
      !existsSync(path.replace(/\.wgsl$/, '.gen.wgsl'))
    )
      yield path
  }
}

const files = [...walk(root)].map((path) => ({
  name: relative(root, path),
  source: readFileSync(path, 'utf8'),
}))

const work = mkdtempSync(join(tmpdir(), 'stargazer-wgsl-'))
const pagePath = join(work, 'page.html')
writeFileSync(pagePath, '<title>check</title>')

const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPUService',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(work, 'profile')}`,
    `file://${pagePath}`,
  ],
  { stdio: 'ignore' },
)

async function untilUp() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      const pages = (await res.json()).filter((p) => p.type === 'page')
      if (pages.length) return pages[0].webSocketDebuggerUrl
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('the browser did not start')
}

const expression = `(async () => {
  const files = ${JSON.stringify(files)}
  const adapter = navigator.gpu && (await navigator.gpu.requestAdapter())
  if (!adapter) throw new Error('no WebGPU adapter')
  const device = await adapter.requestDevice()
  return Promise.all(
    files.map(async (f) => {
      const info = await device
        .createShaderModule({ code: f.source })
        .getCompilationInfo()
      return {
        name: f.name,
        messages: info.messages
          .filter((m) => m.type === 'error')
          .map((m) => m.lineNum + ':' + m.linePos + ' ' + m.message),
      }
    }),
  )
})()`

let results
try {
  const socket = new WebSocket(await untilUp())
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  results = await new Promise((resolve, reject) => {
    socket.onmessage = (event) => {
      const { result } = JSON.parse(event.data)
      if (result.exceptionDetails) {
        reject(new Error(result.exceptionDetails.exception?.description))
      } else resolve(result.result.value)
    }
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })
  socket.close()
} catch (err) {
  console.error(`check:wgsl: ${err.message}`)
  process.exitCode = 2
} finally {
  browser.kill('SIGKILL')
}

if (results) {
  let failed = 0
  for (const { name, messages } of results) {
    for (const m of messages) {
      failed++
      console.error(`${name}:${m}`)
    }
  }
  console.log(`${results.length} files, ${failed} errors`)
  process.exitCode = failed ? 1 : 0
}
