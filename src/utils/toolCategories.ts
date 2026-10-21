/**
 * Tool category helpers — shared by useAgentSettingsForm and AgentSettingsPage.
 *
 * Categories are arbitrary strings declared on the backend (e.g. "communication",
 * "search", "productivity"). They render as section headers in the agent-settings
 * tool list, alphabetised by their human label.
 */
import { i18n } from '@/i18n'
import type { ToolSchema } from '@/composables/useToolSettings'

/**
 * The label for one category slug.
 *
 * The slug is the identity — it is what `#[Tool].category` carries — but the
 * slug is not what an operator reads, so the catalogue is keyed by the English
 * display name and the German value is the translated section header.
 *
 * The keys are literal rather than looked up in a map: a computed key is not
 * harvestable, and a key the extractor cannot see is a key the catalogue
 * cannot be checked against.
 *
 * A slug this switch does not name still renders: the fallback capitalizes
 * it, so an undeclared category reads as `Productivity` rather than as the
 * raw `productivity`.
 */
export function categoryLabel(cat: string): string {
  switch (cat.toLowerCase()) {
    case 'agent':
      return i18n.global.t('Agent')
    case 'communication':
      return i18n.global.t('Communication')
    case 'data':
      return i18n.global.t('Data')
    case 'general':
      return i18n.global.t('General')
    case 'generation':
      return i18n.global.t('Generation')
    case 'information':
      return i18n.global.t('Information')
    case 'llm':
      return i18n.global.t('LLM')
    case 'meta':
      return i18n.global.t('Meta')
    case 'productivity':
      return i18n.global.t('Productivity')
    case 'research':
      return i18n.global.t('Research')
    case 'social-media':
      return i18n.global.t('Social media')
    case 'web':
      return i18n.global.t('Web')
    default:
      return cat.charAt(0).toUpperCase() + cat.slice(1)
  }
}

/** Group tools by their `category` field, defaulting to "general". */
export function groupToolsByCategory(
  tools: ToolSchema[],
): Record<string, ToolSchema[]> {
  const groups: Record<string, ToolSchema[]> = {}
  for (const tool of tools) {
    const cat = (tool as unknown as { category?: string }).category ?? 'general'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(tool)
  }
  return groups
}

/** Return category keys sorted alphabetically by their human label. */
export function sortCategoryKeys(categories: Record<string, unknown>): string[] {
  return Object.keys(categories).sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b)),
  )
}
