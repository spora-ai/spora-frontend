/**
 * useSettingClear — the "clear the stored value" flow for a setting.
 *
 * Three surfaces offer it, and each used to carry its own copy of the
 * confirm text, the reset call and the two toasts. A copy is where the
 * wording and the failure handling drift apart.
 */
import { useI18n } from 'vue-i18n'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useToast } from '@/composables/useToast'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting } from '@/types/globalSettings'

export function useSettingClear() {
  const { t } = useI18n()
  const toast = useToast()
  const { confirm } = useConfirmDialog()
  const store = useGlobalSettingsStore()

  /**
   * The response names the key but not the layer it fell back to, so the
   * registry is re-read rather than guessed at.
   */
  async function clearValue(setting: GlobalSetting): Promise<void> {
    const confirmed = await confirm(
      `${t('Clear the stored value for')} ${setting.label}? ${t('It falls back to your .env, your config.php, or the built-in default.')}`,
      t('Clear stored value?'),
      t('Clear'),
    )
    if (!confirmed) return
    try {
      await store.resetSetting(setting.group, setting.key)
      toast.success(t('{setting} cleared.', { setting: setting.label }))
    } catch {
      toast.error(store.error ?? t('Failed to clear the setting.'))
    }
  }

  return { clearValue }
}
