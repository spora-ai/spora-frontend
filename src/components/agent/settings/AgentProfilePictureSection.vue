<script setup lang="ts">
/**
 * AgentProfilePictureSection — operator-facing picker for the agent's
 * profile picture. Two tabs:
 *
 *   • Avatar — pick one of 8 archetypes, cycle through 3 variants, and
 *     pick one of 10 colour palettes. All three controls are committed
 *     immediately (optimistic, with rollback on 4xx/5xx).
 *
 *   • Image — upload a single image (PNG / JPEG / WebP, ≤ 1 MiB). The
 *     uploaded asset replaces the archetype avatar; the operator can
 *     re-pick an archetype at any time to switch back. "Remove image"
 *     detaches the asset and reverts to the existing archetype.
 *
 * The component owns no form state of its own — every change goes
 * through `agentStore.updateProfilePicture()` / `uploadProfilePictureImage()`
 * / `deleteProfilePictureImage()`. The store updates `currentAgent`
 * synchronously on success, so the live preview at the top of the
 * section is a direct read from the store.
 */
import { computed, ref, useId } from 'vue'
import { ApiError } from '@/api/client'
import { useAgentStore } from '@/stores/agent'
import { useToast } from '@/composables/useToast'
import { ARCHETYPES, VARIANTS } from '@/lib/archetypeSvgs'
import type { Agent } from '@/types/agent'
import type { ArchetypeKey, VariantKey } from '@/lib/archetypeSvgs'
import Avatar from '@/components/ui/Avatar.vue'
import ArchetypeIcon from '@/components/ui/ArchetypeIcon.vue'
import Icon from '@/components/ui/Icon.vue'

const PALETTES: readonly { key: string; label: string }[] = [
  { key: 'slate', label: 'Slate' },
  { key: 'red', label: 'Red' },
  { key: 'orange', label: 'Orange' },
  { key: 'amber', label: 'Amber' },
  { key: 'green', label: 'Green' },
  { key: 'teal', label: 'Teal' },
  { key: 'blue', label: 'Blue' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'violet', label: 'Violet' },
  { key: 'pink', label: 'Pink' },
] as const

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const agentStore = useAgentStore()
const toast = useToast()

type Tab = 'avatar' | 'image'
const activeTab = ref<Tab>('avatar')

const scope = useId()
const fileInputId = `${scope}-picture-file`
const tabAvatarId = `${scope}-tab-avatar`
const tabImageId = `${scope}-tab-image`

const saving = ref<boolean>(false)
const uploading = ref<boolean>(false)
const removing = ref<boolean>(false)
const lastError = ref<string | null>(null)
const pendingFile = ref<File | null>(null)

/** The current archetype avatar as the user sees it. Defaults to assistant/v0. */
const currentArchetype = computed<ArchetypeKey>(() => {
  const a = props.agent.profile_picture?.archetype
  return (ARCHETYPES as readonly string[]).includes(a ?? '') ? (a as ArchetypeKey) : 'assistant'
})

const currentVariant = computed<VariantKey>(() => {
  const v = props.agent.profile_picture?.variant_key
  return (VARIANTS as readonly string[]).includes(v ?? '') ? (v as VariantKey) : 'v0'
})

const currentPalette = computed<string>(() => {
  const p = props.agent.profile_picture?.palette_key
  return typeof p === 'string' && p.length > 0 ? p : 'slate'
})

const isImageKind = computed<boolean>(
  () => props.agent.profile_picture?.kind === 'image',
)

const previewProfilePicture = computed(() => {
  // The preview mirrors the agent's saved picture. When the user has
  // chosen a different archetype/variant in the picker but the PATCH is
  // still in flight, we render the *saved* picture (the store hasn't
  // updated yet) — the toast on success confirms the change instead.
  return props.agent.profile_picture ?? null
})

function nextVariant(v: VariantKey): VariantKey {
  const idx = VARIANTS.indexOf(v)
  return VARIANTS[(idx + 1) % VARIANTS.length] ?? 'v0'
}

async function pickArchetype(archetype: ArchetypeKey): Promise<void> {
  await commit({ archetype })
}

async function cycleVariant(): Promise<void> {
  await commit({ variant_key: nextVariant(currentVariant.value) })
}

async function pickPalette(palette: string): Promise<void> {
  await commit({ palette_key: palette })
}

async function commit(patch: {
  archetype?: string | null
  variant_key?: string | null
  palette_key?: string | null
}): Promise<void> {
  saving.value = true
  lastError.value = null
  try {
    await agentStore.updateProfilePicture(props.agentId, patch)
  } catch (e) {
    lastError.value = e instanceof ApiError ? e.message : 'Failed to update picture.'
    toast.error(lastError.value)
  } finally {
    saving.value = false
  }
}

function onFileChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const file = target.files?.[0] ?? null
  pendingFile.value = file
  lastError.value = null
}

async function uploadImage(): Promise<void> {
  const file = pendingFile.value
  if (file === null) return
  uploading.value = true
  lastError.value = null
  try {
    await agentStore.uploadProfilePictureImage(props.agentId, file)
    pendingFile.value = null
    toast.success('Profile picture updated.')
  } catch (e) {
    lastError.value = e instanceof ApiError ? e.message : 'Upload failed.'
    toast.error(lastError.value)
  } finally {
    uploading.value = false
  }
}

async function removeImage(): Promise<void> {
  removing.value = true
  lastError.value = null
  try {
    await agentStore.deleteProfilePictureImage(props.agentId)
    toast.success('Picture reverted to avatar.')
  } catch (e) {
    lastError.value = e instanceof ApiError ? e.message : 'Failed to remove image.'
    toast.error(lastError.value)
  } finally {
    removing.value = false
  }
}

function clearPending(): void {
  pendingFile.value = null
  lastError.value = null
}

function paletteSwatchStyle(key: string): string {
  const match = (PALETTES as readonly { key: string; label: string }[]).find((p) => p.key === key)
  const hex = paletteHex(match?.key ?? 'slate')
  return `background-color: ${hex};`
}

function paletteHex(key: string): string {
  switch (key) {
    case 'slate': return '#475569'
    case 'red': return '#DC2626'
    case 'orange': return '#EA580C'
    case 'amber': return '#D97706'
    case 'green': return '#15803D'
    case 'teal': return '#0F766E'
    case 'blue': return '#1D4ED8'
    case 'indigo': return '#4338CA'
    case 'violet': return '#6D28D9'
    case 'pink': return '#BE185D'
    default: return '#475569'
  }
}

function archetypeLabel(archetype: ArchetypeKey): string {
  return archetype.charAt(0).toUpperCase() + archetype.slice(1)
}
</script>

<template>
  <section
    class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4"
    data-testid="profile-picture-section"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-base font-semibold">Profile Picture</h2>
      <span v-if="saving || uploading || removing" class="text-xs text-muted-foreground" data-testid="picture-saving">
        Saving…
      </span>
    </div>

    <div class="flex items-center gap-4">
      <Avatar
        :initials="agent.name.charAt(0).toUpperCase()"
        :profile-picture="previewProfilePicture"
        size="xl"
        tone="muted"
      />
      <div class="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          Operators can pick an archetype avatar or upload a custom image.
        </p>
        <p class="text-xs">
          PNG / JPEG / WebP — max 1&nbsp;MiB. Pictures are visible across the dashboard, sidebar, and agent header.
        </p>
      </div>
    </div>

    <div role="tablist" class="flex items-center gap-1 border-b border-border">
      <button
        :id="tabAvatarId"
        role="tab"
        :aria-selected="activeTab === 'avatar'"
        type="button"
        data-testid="tab-avatar"
        @click="activeTab = 'avatar'"
        :class="[
          'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px',
          activeTab === 'avatar'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        ]"
      >
        Avatar
      </button>
      <button
        :id="tabImageId"
        role="tab"
        :aria-selected="activeTab === 'image'"
        type="button"
        data-testid="tab-image"
        @click="activeTab = 'image'"
        :class="[
          'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px',
          activeTab === 'image'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        ]"
      >
        Image
      </button>
    </div>

    <!-- Avatar tab -->
    <div v-if="activeTab === 'avatar'" role="tabpanel" :aria-labelledby="tabAvatarId" class="flex flex-col gap-5" data-testid="panel-avatar">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Archetype</label>
        <div class="grid grid-cols-4 gap-2" data-testid="archetype-grid">
          <button
            v-for="archetype in ARCHETYPES"
            :key="archetype"
            type="button"
            :data-testid="`archetype-${archetype}`"
            :aria-pressed="currentArchetype === archetype"
            @click="pickArchetype(archetype)"
            :class="[
              'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors',
              currentArchetype === archetype
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted',
            ]"
          >
            <span
              class="h-10 w-10 rounded-lg flex items-center justify-center"
              :style="{ backgroundColor: paletteHex(currentPalette), color: '#fff' }"
            >
              <ArchetypeIcon :archetype="archetype" :variant="currentVariant" svg-class="h-6 w-6" />
            </span>
            <span>{{ archetypeLabel(archetype) }}</span>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-sm font-medium">Variant</span>
        <button
          type="button"
          data-testid="variant-cycle"
          @click="cycleVariant"
          class="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Icon name="refresh" class="h-3.5 w-3.5" />
          <span>{{ currentVariant }}</span>
        </button>
        <span class="text-xs text-muted-foreground">3 visual variants per archetype.</span>
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium">Palette</label>
        <div class="flex flex-wrap gap-2" data-testid="palette-grid">
          <button
            v-for="palette in PALETTES"
            :key="palette.key"
            type="button"
            :data-testid="`palette-${palette.key}`"
            :aria-label="`Palette ${palette.label}`"
            :aria-pressed="currentPalette === palette.key"
            @click="pickPalette(palette.key)"
            :class="[
              'h-7 w-7 rounded-full border-2 transition-transform',
              currentPalette === palette.key
                ? 'border-foreground scale-110'
                : 'border-transparent hover:scale-105',
            ]"
            :style="paletteSwatchStyle(palette.key)"
          />
        </div>
      </div>
    </div>

    <!-- Image tab -->
    <div v-else role="tabpanel" :aria-labelledby="tabImageId" class="flex flex-col gap-3" data-testid="panel-image">
      <p class="text-sm text-muted-foreground">
        Upload a square image for the best result. Replaces the archetype avatar until you re-pick one.
      </p>
      <div v-if="isImageKind" class="flex flex-col gap-2">
        <div class="text-sm">
          <span class="font-medium">Current image:</span>
          <span class="text-muted-foreground"> uploaded asset is shown in the preview above.</span>
        </div>
        <button
          type="button"
          data-testid="remove-image"
          :disabled="removing"
          @click="removeImage"
          class="inline-flex h-9 w-fit items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          {{ removing ? 'Removing…' : 'Remove image (revert to avatar)' }}
        </button>
      </div>
      <div class="flex flex-col gap-2">
        <label :for="fileInputId" class="text-sm font-medium">Upload new image</label>
        <input
          :id="fileInputId"
          data-testid="picture-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          @change="onFileChange"
          class="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        <p class="text-xs text-muted-foreground">PNG / JPEG / WebP, ≤ 1 MiB.</p>
        <div v-if="pendingFile" class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground" data-testid="pending-file-name">{{ pendingFile.name }}</span>
          <button
            type="button"
            data-testid="upload-image"
            :disabled="uploading"
            @click="uploadImage"
            class="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {{ uploading ? 'Uploading…' : 'Upload' }}
          </button>
          <button
            type="button"
            @click="clearPending"
            class="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <p v-if="lastError" role="alert" data-testid="picture-error" class="text-xs text-destructive">
      {{ lastError }}
    </p>
  </section>
</template>
