/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the printer-daemon. Empty / unset means same-origin, which in
   * dev is handled by the Vite proxy (`/api/printer` → the daemon). On the
   * kiosk this points at the local daemon origin (e.g. `http://localhost:9110`).
   */
  readonly VITE_PRINTER_DAEMON_URL?: string
}

/**
 * Import SVG files as raw strings, e.g. `import icon from
 * '@src/assets/foo.svg?raw'`.
 */
declare module '*.svg?raw' {
  const content: string
  export default content
}

/**
 * Import GLSL shader files as raw strings, e.g. `import vs from
 * './shaders/coloredTri.vert.glsl?raw'`. Keeps shader source in its own file so
 * compile-error line numbers map 1:1 to the editor.
 */
declare module '*.glsl?raw' {
  const content: string
  export default content
}
