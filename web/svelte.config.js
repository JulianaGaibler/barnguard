import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Prepend the shared SASS utilities to every component `<style lang="sass">`
 * block so the `tint.*` namespace is available without an explicit `@use`.
 * Mirrors the behavior configured for Vite in `vite.config.ts`.
 *
 * @param {string} source - The original SASS source of the style block.
 * @returns {string} The source with the `@use` prepended.
 */
const prependStyleUtils = (source) => {
  const prepend = `@use "@src/styles/utils.sass" as tint\n`
  const match = source.match(/^\s*/)
  const spaces = match ? match[0] : ''
  return `${spaces}${prepend}\n${source}`
}

export default {
  preprocess: vitePreprocess({
    style: {
      css: {
        preprocessorOptions: {
          sass: {
            additionalData: prependStyleUtils,
          },
        },
      },
    },
  }),
}
