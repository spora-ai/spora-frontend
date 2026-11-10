<script setup lang="ts">
/**
 * LocationsSection — the saved addresses of one principal.
 *
 * One component serves the profile page and the group settings page, so the
 * two surfaces cannot drift apart. The component owns the list and the
 * add/edit modal; the parent owns the data and the API calls, which is what
 * lets a user and a group share one markup.
 *
 * A failed save is reported through the `error` prop, because the modal
 * closes as soon as the payload is handed over — the parent decides whether
 * the failure is worth a toast, an inline message, or both.
 */
import { ref } from 'vue'
import { Icon } from '@spora-ai/components/icons'
import {
  emptyLocationForm,
  firstLocationError,
  validateLocationForm,
  type Location,
  type LocationForm,
} from '@/composables/useLocations'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  locations: Location[]
  /** False hides every mutating control, leaving a read-only list. */
  canEdit?: boolean
  loading?: boolean
  error?: string | null
}>(), {
  canEdit: true,
  loading: false,
  error: null,
})

const emit = defineEmits<{
  create: [payload: LocationForm]
  update: [locationId: number, payload: LocationForm]
  delete: [locationId: number]
}>()

const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref<LocationForm>(emptyLocationForm())
const formError = ref<string | null>(null)

function openAdd(): void {
  form.value = emptyLocationForm()
  editingId.value = null
  formError.value = null
  showForm.value = true
}

function openEdit(location: Location): void {
  form.value = {
    name: location.name,
    address: location.address,
    is_default: location.is_default,
  }
  editingId.value = location.id
  formError.value = null
  showForm.value = true
}

function closeForm(): void {
  showForm.value = false
  editingId.value = null
  formError.value = null
}

function submit(): void {
  const error = firstLocationError(validateLocationForm(form.value))
  if (error !== null) {
    formError.value = error
    return
  }
  const payload: LocationForm = { ...form.value }
  if (editingId.value === null) {
    emit('create', payload)
  } else {
    emit('update', editingId.value, payload)
  }
  closeForm()
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {{ t('Locations') }}
      </h3>
      <button
        v-if="props.canEdit"
        @click="openAdd"
        class="inline-flex h-7 items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        type="button"
      >
        <Icon
          name="plus"
          class="h-3.5 w-3.5"
        />
        {{ t('Add location') }}
      </button>
    </div>

    <div
      v-if="props.loading"
      class="text-sm text-muted-foreground"
    >
      {{ t('Loading…') }}
    </div>
    <div
      v-else-if="props.locations.length === 0"
      class="text-sm text-muted-foreground"
    >
      {{ t('No locations saved yet.') }}
    </div>
    <div
      v-else
      class="space-y-3"
    >
      <div
        v-for="loc in props.locations"
        :key="loc.id"
        data-testid="location-row"
        class="flex items-start justify-between p-3 rounded-lg border border-border gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium truncate">
              {{ loc.name }}
            </p>
            <span
              v-if="loc.is_default"
              class="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
            >{{ t('default') }}</span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 truncate">
            {{ loc.address }}
          </p>
        </div>
        <div
          v-if="props.canEdit"
          class="flex items-center gap-1 shrink-0"
        >
          <button
            @click="openEdit(loc)"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            type="button"
          >
            <Icon
              name="pencil"
              class="h-3.5 w-3.5"
            />
          </button>
          <button
            @click="emit('delete', loc.id)"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            type="button"
          >
            <Icon
              name="trash"
              class="h-3.5 w-3.5"
            />
          </button>
        </div>
      </div>
    </div>
    <p
      v-if="props.error"
      role="alert"
      class="text-xs text-destructive"
    >
      {{ props.error }}
    </p>

    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        :aria-label="t('Close dialog')"
        class="absolute inset-0 bg-black/50"
        @click="closeForm"
      />
      <div class="relative w-full max-w-sm rounded-xl border border-border bg-background p-5 space-y-4 shadow-xl">
        <h3 class="text-sm font-semibold">
          {{ editingId !== null ? t('Edit Location') : t('Add Location') }}
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1.5">
            <label
              for="loc-name"
              class="text-sm font-medium"
            >{{ t('Name *') }}</label>
            <input
              id="loc-name"
              v-model="form.name"
              type="text"
              :placeholder="t('e.g. Home, Work, Beach House')"
              class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
          </div>
          <div class="flex flex-col gap-1.5">
            <label
              for="loc-address"
              class="text-sm font-medium"
            >{{ t('Address *') }}</label>
            <textarea
              id="loc-address"
              v-model="form.address"
              rows="2"
              :placeholder="t('Full address')"
              class="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="flex items-center gap-2">
            <input
              id="loc-default"
              v-model="form.is_default"
              type="checkbox"
              class="h-4 w-4 rounded border-border bg-background text-primary focus:ring-1 focus:ring-ring"
            >
            <label
              for="loc-default"
              class="text-sm font-medium"
            >{{ t('Set as default') }}</label>
          </div>
        </div>
        <p
          v-if="formError"
          role="alert"
          class="text-xs text-destructive"
        >
          {{ formError }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            @click="closeForm"
            class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium shadow transition-colors hover:bg-muted"
            type="button"
          >
            {{ t('Cancel') }}
          </button>
          <button
            @click="submit"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            type="button"
          >
            {{ t('Save Location') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
