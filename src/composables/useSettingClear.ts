/**
 * useSettingClear — the "clear the stored value" flow for a setting.
 *
 * Three surfaces offer it: the runtime pages, the Plugins tab and the
 * section overlay. Each of them used to carry its own copy of the confirm
 * text, the reset call and the two toasts, and a copy is where the wording
 * and the failure handling drift apart — right next to the secret rules,
 * which is the last place a second rule belongs.
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
   * Delete the stored row so the value comes from the files again. The
   * response names the key but not the layer it fell back to, so the registry
   * is re-read rather than guessed at.
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
