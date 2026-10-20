/**
 * useConfirmDialog — global confirm dialog composable.
 *
 * Usage:
 *   const { confirm } = useConfirmDialog()
 *   const confirmed = await confirm('Delete this?')
 *
 * The dialog is auto-mounted to the app root on first use.
 */
import { ref, createApp, h } from 'vue'
import { i18n } from '@/i18n'
import ConfirmDialogComponent from '@/components/ui/ConfirmDialog.vue'

const dialogRef = ref<InstanceType<typeof ConfirmDialogComponent> | null>(null)
let mounted = false

function ensureMounted(): void {
  if (mounted) return
  mounted = true

  const mount = document.createElement('div')
  document.body.appendChild(mount)

  const app = createApp({
    render: () => h(ConfirmDialogComponent, {
      ref: (el: unknown) => { dialogRef.value = el as typeof dialogRef.value }
    })
  })
  // The dialog lives in its own Vue app, so it needs the i18n plugin of its
  // own: a component in this app resolves `useI18n()` through the instance
  // provided on *its* app context, not through the one the main app installed.
  // The shared instance is the right one to install — it is the instance whose
  // locale the operator's language switch moves.
  app.use(i18n)
  app.mount(mount)
}

// Hoisted to module scope: doesn't depend on per-call state (SonarQube typescript:S7721).
async function confirm(
  message: string,
  title?: string,
  confirmLabel?: string,
  cancelLabel?: string,
): Promise<boolean> {
  if (!dialogRef.value) return false
  return await dialogRef.value.open(
    message,
    title ?? i18n.global.t('Confirm'),
    confirmLabel ?? i18n.global.t('Delete'),
    cancelLabel ?? i18n.global.t('Cancel'),
  ) ?? false
}

export function useConfirmDialog() {
  ensureMounted()
  return { confirm }
}