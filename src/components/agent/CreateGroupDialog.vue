<script setup lang="ts">
/**
 * CreateGroupDialog — modal form for creating a group.
 *
 * Mirrors the wiring pattern of `CreateAgentDialog`: rendered once at
 * the app root inside GlobalNavbar, driven by `useCreateGroupDialogStore`.
 * Any caller can `store.open()` to surface it.
 *
 * On submit, posts to `groupsStore.createGroup({ name, description })`
 * and routes the operator into the new group's overview. The store's
 * `saving` flag drives the submit button's disabled state so a
 * double-click on Create can't fire two POSTs.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import { useCreateGroupDialogStore } from '@/stores/createGroupDialog'
import { useGroupsStore } from '@/stores/groups'
import { useToast } from '@/composables/useToast'

const dialog = useCreateGroupDialogStore()
const groupsStore = useGroupsStore()
const toast = useToast()
const router = useRouter()

const name = ref('')
const description = ref('')
const errorMessage = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

const isOpen = computed<boolean>({
  get: () => dialog.isOpen,
  set: (v) => {
    if (!v) dialog.close()
  },
})

watch(isOpen, async (open) => {
  if (open) {
    name.value = ''
    description.value = ''
    errorMessage.value = null
    await nextTick()
    nameInput.value?.focus()
  }
})

async function submit(): Promise<void> {
  const trimmed = name.value.trim()
  if (trimmed === '') {
    errorMessage.value = 'Name is required.'
    return
  }
  errorMessage.value = null
  try {
    const group = await groupsStore.createGroup({
      name: trimmed,
      description: description.value.trim() === '' ? undefined : description.value.trim(),
    })
    toast.success(`Created group “${group.name}”`)
    dialog.close()
    await router.push({ name: 'group-overview', params: { id: String(group.id) } })
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to create group.'
  }
}

function onSubmitKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault()
    void submit()
  }
}
</script>

<template>
  <Modal
    v-model="isOpen"
    title="Create group"
    size="sm"
  >
    <form
      class="space-y-4"
      @submit.prevent="submit"
      @keydown="onSubmitKeydown"
    >
      <div>
        <label
          for="create-group-name"
          class="block text-sm font-medium text-foreground mb-1.5"
        >
          Name
          <span class="text-destructive">*</span>
        </label>
        <input
          id="create-group-name"
          ref="nameInput"
          v-model="name"
          type="text"
          placeholder="e.g. Engineering"
          :disabled="groupsStore.saving"
          class="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          maxlength="80"
        >
      </div>

      <div>
        <label
          for="create-group-description"
          class="block text-sm font-medium text-foreground mb-1.5"
        >
          Description
        </label>
        <textarea
          id="create-group-description"
          v-model="description"
          rows="3"
          placeholder="What is this group for?"
          :disabled="groupsStore.saving"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
          maxlength="500"
        />
      </div>

      <p
        v-if="errorMessage"
        class="text-xs text-destructive"
      >
        {{ errorMessage }}
      </p>
    </form>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          class="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="groupsStore.saving"
          @click="dialog.close()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          :disabled="name.trim() === '' || groupsStore.saving"
          @click="submit"
        >
          {{ groupsStore.saving ? 'Creating…' : 'Create' }}
        </button>
      </div>
    </template>
  </Modal>
</template>
