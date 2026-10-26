import { beforeEach, describe, expect, it } from 'vitest'
import { isInstalledApp, linkInstallMetadata } from './installable'

describe('linkInstallMetadata', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  it('adds the manifest, the touch icon and the title', () => {
    linkInstallMetadata('age-verification', 'Age Verification', {})
    expect(
      document.head.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    ).toBe('./manifest-age-verification.webmanifest')
    expect(
      document.head
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute('href'),
    ).toBe('./icons/age-verification-180.png')
    expect(
      document.head
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute('content'),
    ).toBe('Age Verification')
  })

  it('replaces what is there instead of adding a second set', () => {
    linkInstallMetadata('age-verification', 'Age Verification', {})
    linkInstallMetadata('policy-story', 'Policy Story', {})
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(
      1,
    )
    expect(
      document.head.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    ).toBe('./manifest-policy-story.webmanifest')
  })

  it('gives a dark display a black status bar, and leaves the others', () => {
    const bar = () =>
      document.head
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content')
    linkInstallMetadata('contrast', 'Contrast', {
      statusBarStyle: 'black',
    })
    expect(bar()).toBe('black')
    document.head.innerHTML =
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
    linkInstallMetadata('age-verification', 'Age Verification', {})
    expect(bar()).toBe('default')
  })
})

describe('isInstalledApp', () => {
  const windowWith = (standalone: boolean | undefined, modes: string[]) =>
    ({
      navigator: { standalone },
      matchMedia: (query: string) => ({
        matches: modes.some((mode) => query.includes(mode)),
      }),
    }) as unknown as Window

  it('knows an app opened from the iOS home screen', () => {
    expect(isInstalledApp(windowWith(true, []))).toBe(true)
  })

  it('knows a standalone or fullscreen display mode', () => {
    expect(isInstalledApp(windowWith(undefined, ['standalone']))).toBe(true)
    expect(isInstalledApp(windowWith(undefined, ['fullscreen']))).toBe(true)
  })

  it('says no in a browser tab', () => {
    expect(isInstalledApp(windowWith(false, []))).toBe(false)
    expect(isInstalledApp(windowWith(undefined, []))).toBe(false)
  })
})
