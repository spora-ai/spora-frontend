// Pinia store backing the unified Create Agent dialog.
//
// The dialog is rendered once at the app root (inside GlobalNavbar) and
// driven by this store's reactive state. Any component that needs to
// trigger the flow — the dashboard's "+" button, the agent sidebar's
// "+", the agent list's empty-state CTA — calls open() and the
// dialog appears with whichever mode was requested.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type CreateAgentMode = 'choice' | 'blank' | 'template' | 'upload' | 'preview'

export const useCreateAgentDialogStore = defineStore('createAgentDialog', () => {
  const isOpen = ref(false)
  const mode = ref<CreateAgentMode>('choice')

  /**
   * Open the dialog in the given mode. Defaults to 'choice' (the
   * three-card landing screen).
   */
  function open(initial: CreateAgentMode = 'choice'): void {
    mode.value = initial
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
    // Reset to choice for the next time the dialog opens so the
    // user always lands on the same three-card picker.
    mode.value = 'choice'
  }

  function setMode(next: CreateAgentMode): void {
    mode.value = next
  }

  return { isOpen, mode, open, close, setMode }
})