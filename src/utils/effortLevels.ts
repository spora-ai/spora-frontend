/**
 * The label for one effort level.
 *
 * The endpoint labels the levels itself — the labels come from the driver
 * class's `effort` setting options — so this is the fallback for a level the
 * endpoint did not name.
 *
 * The keys are literal rather than looked up in a map: a computed key is not
 * harvestable, and a key the extractor cannot see is a key the catalogue
 * cannot be checked against.
 */
import { i18n } from '@/i18n'

export function effortLevelLabel(level: string): string {
  switch (level) {
    case 'none':
      return i18n.global.t('None')
    case 'minimal':
      return i18n.global.t('Minimal')
    case 'low':
      return i18n.global.t('Low')
    case 'medium':
      return i18n.global.t('Medium')
    case 'high':
      return i18n.global.t('High')
    case 'xhigh':
      return i18n.global.t('xHigh')
    case 'max':
      return i18n.global.t('Max')
    default:
      return level
  }
}
