import type { DemoFn } from './types'

// Registry of runnable dev demos. Each entry lazy-imports the module to keep
// the production bundle from pulling all demos in.
export const demos: Record<string, () => Promise<DemoFn>> = {
  loop: () => import('./demo-loop').then((m) => m.default),
  scene: () => import('./demo-scene').then((m) => m.default),
  debug: () => import('./demo-debug').then((m) => m.default),
  svg: () => import('./demo-svg').then((m) => m.default),
  input: () => import('./demo-input').then((m) => m.default),
  anim: () => import('./demo-anim').then((m) => m.default),
  particles: () => import('./demo-particles').then((m) => m.default),
  camera: () => import('./demo-camera').then((m) => m.default),
  stages: () => import('./demo-stages').then((m) => m.default),
}

export type DemoName = keyof typeof demos
