/**
 * The locale the interface is rendered in.
 *
 * The app's own locale, not the browser's: `toLocaleString(undefined, …)`
 * follows the runtime's locale, which is the machine's — not the language the
 * operator picked.
 */
import { i18n } from '@/i18n'

export function activeLocale(): string {
  return i18n.global.locale.value
}
