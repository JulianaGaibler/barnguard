import { createEngineHost } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { LottieNode } from '../nodes/LottieNode'
import { parseLottie } from '../lottie/model/parse'
import type { LottieAnimation } from '../lottie/model/types'
import { loadDotLottie, type DotLottie } from '../lottie/dotlottie/dotlottie'
import type { DemoFn } from './types'

// Lottie sandbox. Pick a fixture, scrub or play it, and read the diagnostics
// the loader and renderer produce. `?count=N` tiles N copies of the animation
// to watch batching and per-frame cost in the debug HUD. `?gfx=webgpu` forces
// the other backend.
//
// `?ref` adds a reference render beside ours for comparison. It loads the
// dotlottie-web player (a different Lottie renderer) as an ES module from a URL,
// by default `https://esm.sh/@lottiefiles/dotlottie-web`, and draws the same
// file on a second canvas, stepped to the same frame as ours. Use `?ref=<url>`
// to load the module from somewhere else, for example a local build. Nothing is
// fetched without `?ref`.

const fixtures = import.meta.glob('./fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const archives = import.meta.glob('./fixtures/lottie/*.lottie', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const archiveNames = Object.keys(archives).map(
  (p) => p.replace('./fixtures/lottie/', '').replace('.lottie', '') + '.lottie',
)

const names = Object.keys(fixtures)
  .map((p) => p.replace('./fixtures/lottie/', '').replace('.json', ''))
  .concat(archiveNames)
  .sort()

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const params = new URLSearchParams(window.location.search)
  const count = Math.max(1, Number(params.get('count') ?? 1))
  let name = params.get('file') ?? names[0]
  if (!names.includes(name)) name = names[0]

  let playing = true
  const host = createEngineHost({ canvas, clearColor: '#14171f' })
  attach?.(host)

  let nodes: LottieNode[] = []
  let anim!: LottieAnimation
  let file: DotLottie | null = null
  const theme = document.createElement('select')

  /** Load a fixture, filling the theme list for an archive. */
  const open = async (fixture: string): Promise<void> => {
    file = null
    theme.replaceChildren(new Option('no theme', ''))
    if (fixture.endsWith('.lottie')) {
      const key = `./fixtures/lottie/${fixture}`
      file = await loadDotLottie(archives[key])
      anim = file.getAnimation()
      for (const id of file.themeIds) theme.add(new Option(id, id))
    } else {
      anim = parseLottie(fixtures[`./fixtures/lottie/${fixture}.json`])
    }
    theme.style.display = file && file.themeIds.length > 0 ? '' : 'none'
  }
  await open(name)

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:12px;right:12px;width:260px;max-height:calc(100% - 76px);overflow:auto;padding:10px;background:rgba(10,12,18,.88);border:1px solid rgba(255,255,255,.15);border-radius:6px;font:11px/1.5 system-ui,sans-serif;color:#fff;z-index:400'
  document.body.appendChild(panel)

  const select = document.createElement('select')
  for (const n of names) select.add(new Option(n, n, false, n === name))
  const play = document.createElement('button')
  const scrub = document.createElement('input')
  scrub.type = 'range'
  scrub.min = '0'
  scrub.style.width = '100%'
  const info = document.createElement('div')
  const diag = document.createElement('pre')
  diag.style.cssText = 'white-space:pre-wrap;margin:6px 0 0;opacity:.8'
  panel.append(select, theme, play, scrub, info, diag)

  const build = (): void => {
    for (const n of nodes) n.destroy()
    nodes = []
    const side = Math.ceil(Math.sqrt(count))
    const cell = Math.min(1080 / side, 1920 / side)
    for (let i = 0; i < count; i++) {
      // Each node parses its own copy, so a theme applies to one node only.
      const node = new LottieNode({
        animation: file ? file.getAnimation() : anim,
        width: cell,
        height: cell,
        offscreen: 'freeze',
      })
      node.transform.x = (i % side) * cell
      node.transform.y = Math.floor(i / side) * cell
      if (file && theme.value) node.setTheme(file.getTheme(theme.value))
      host.engine.tree.root.add(node)
      nodes.push(node)
    }
    scrub.max = String(anim.totalFrames - 1)
    diag.textContent = nodes[0].diagnostics.length
      ? nodes[0].diagnostics
          .map((d) => `${d.code}${d.layer ? ` (${d.layer})` : ''}`)
          .join('\n')
      : 'no diagnostics'
  }

  await host.loadScene((scene) => {
    addDemoCamera(scene, { x: 0, y: 0, width: 1920, height: 1080 })
  })
  build()
  const startFrame = params.get('frame')
  if (startFrame !== null) {
    playing = false
    for (const n of nodes) {
      n.pause()
      n.seek(Number(startFrame))
    }
  }

  select.onchange = async () => {
    name = select.value
    await open(name)
    build()
    void openRef()
  }
  theme.onchange = () => {
    build()
    if (file && theme.value) ref?.setTheme?.(theme.value)
  }
  play.onclick = () => {
    playing = !playing
    for (const n of nodes) {
      if (playing) n.play()
      else n.pause()
    }
  }
  scrub.oninput = () => {
    playing = false
    for (const n of nodes) {
      n.pause()
      n.seek(Number(scrub.value))
    }
  }
  // Reference renderer, opt in with `?ref`.
  const refParam = params.get('ref')
  const refUrl =
    refParam === null
      ? null
      : refParam || 'https://esm.sh/@lottiefiles/dotlottie-web'
  const refBox = document.createElement('div')
  const refCanvas = document.createElement('canvas')
  const refLabel = document.createElement('div')
  type RefPlayer = {
    setFrame(f: number): void
    setTheme?(id: string): boolean
    destroy(): void
  }
  let ref: RefPlayer | null = null
  let refGeneration = 0
  if (refUrl) {
    refBox.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:400;padding:6px;background:rgba(10,12,18,.88);border:1px solid rgba(255,255,255,.15);border-radius:6px;font:11px system-ui,sans-serif;color:#fff'
    refCanvas.width = 480
    refCanvas.height = 480
    refCanvas.style.cssText =
      'width:240px;height:240px;background:#fff;display:block'
    refLabel.textContent = 'reference: loading'
    refBox.append(refLabel, refCanvas)
    document.body.appendChild(refBox)
  }

  /** (Re)create the reference player for the open fixture. */
  const openRef = async (): Promise<void> => {
    if (!refUrl) return
    const generation = ++refGeneration
    ref?.destroy()
    ref = null
    try {
      const mod = (await import(/* @vite-ignore */ refUrl)) as {
        DotLottie: new (config: Record<string, unknown>) => RefPlayer
      }
      if (generation !== refGeneration) return
      const fixture = name
      const config: Record<string, unknown> = {
        canvas: refCanvas,
        autoplay: false,
        loop: false,
      }
      if (fixture.endsWith('.lottie')) {
        config.src = new URL(
          archives[`./fixtures/lottie/${fixture}`],
          location.href,
        ).href
      } else {
        config.data = fixtures[`./fixtures/lottie/${fixture}.json`]
      }
      ref = new mod.DotLottie(config)
      refLabel.textContent = `reference: ${refUrl}`
    } catch (e) {
      refLabel.textContent = `reference failed: ${(e as Error).message}`
    }
  }
  void openRef()

  const off = host.events.on('frame', () => {
    play.textContent = playing ? 'Pause' : 'Play'
    const n = nodes[0]
    if (!n) return
    if (playing) scrub.value = String(Math.floor(n.currentFrame))
    ref?.setFrame(n.currentFrame)
    info.textContent = `${anim.width}×${anim.height}  ${anim.frameRate.toFixed(1)} fps  frame ${n.currentFrame.toFixed(1)} / ${anim.totalFrames}  evals ${n.stats.evaluations}`
  })

  host.start()
  const stop = (): void => {
    off()
    ref?.destroy()
    refBox.remove()
    panel.remove()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
