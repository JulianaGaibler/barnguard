/**
 * Which build is running: its commit and when it was built, stamped in by
 * `vite.config.ts`. Lets staff tell whether a device has taken an update.
 * Tests run without the stamp.
 */
export const APP_BUILD: string =
  typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'
