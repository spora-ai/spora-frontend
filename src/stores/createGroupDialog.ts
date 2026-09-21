// Pinia store backing the Create Group modal.
//
// The dialog is rendered once at the app root (inside GlobalNavbar)
// and driven by this store's reactive state. Any component that needs
// to trigger the flow — the command palette's "Create group" action,
// the sidebar's "+", a future "+ New group" button on the groups
// page — calls open() and the modal appears with a blank form.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCreateGroupDialogStore = defineStore('createGroupDialog', () => {
  const isOpen = ref(false)

  function open(): void {
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
  }

  return { isOpen, open, close }
})
