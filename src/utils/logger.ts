/* eslint-disable no-console */
// The app's logging prefix and the one place to flip behaviour (e.g. ship to a
// remote sink later). The client worker logs to `console` directly — it runs
// outside the app bundle and cannot import this module.
const tag = '[spora]'

export const log = {
  error: (...a: unknown[]): void => console.error(tag, ...a),
  warn:  (...a: unknown[]): void => console.warn(tag, ...a),
  debug: (...a: unknown[]): void => { if (import.meta.env.DEV) console.debug(tag, ...a) },
}
