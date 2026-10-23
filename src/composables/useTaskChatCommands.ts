/**
 * useTaskChatCommands — the task commands the chat offers.
 *
 * A command is an action on the conversation itself rather than on the
 * composer: "compact this conversation" is not something you type, it is
 * something you ask for. The list is data so the menu stays a dumb
 * renderer and a second command is one entry rather than a new component.
 */
import { computed, ref } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { ApiError } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { i18n } from '@/i18n'
import type { CommandAction } from '@/components/ui/CommandMenu.vue'

export function useTaskChatCommands() {
  const taskStore = useTaskStore()
  const toast = useToast()

  /** True while a compaction is in flight — the menu's trigger is disabled. */
  const compacting = ref(false)

  const commands = computed<CommandAction[]>(() => [
    {
      id: 'compact',
      label: i18n.global.t('Compact conversation'),
      description: i18n.global.t('Replace the older turns with a summary. They stay readable here.'),
      icon: 'list-checks',
      disabled: compacting.value,
      onSelect: () => {
        void compactConversation()
      },
    },
  ])

  /**
   * Replace everything but the last few turns with a summary.
   *
   * The turns stay in the transcript — the model gets the summary, the
   * operator keeps the turns — so this is safe to run and safe to re-run.
   */
  async function compactConversation(): Promise<void> {
    const task = taskStore.activeTask
    if (task === null || compacting.value) return

    compacting.value = true
    try {
      const result = await taskStore.compactTask(task.id)
      if (!result.compacted) {
        toast.info(i18n.global.t('Nothing to compact yet — the conversation is still short.'))
        return
      }
      toast.success(i18n.global.t('Conversation compacted.'))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : i18n.global.t('Failed to compact the conversation.'))
    } finally {
      compacting.value = false
    }
  }

  return {
    commands,
    compacting,
    compactConversation,
  }
}
