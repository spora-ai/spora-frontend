<script setup lang="ts">
/**
 * ApiKeyTable — an agent's keys, with create and revoke.
 *
 * There is no column for the secret, because there is none to show: the
 * plaintext exists only in the create response. The table carries the
 * metadata an operator needs to decide what is still in use.
 */
import { onBeforeUnmount, ref, watch } from "vue";
import type { AgentApiKey } from "@/types/agentApiKey";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useToast } from "@/composables/useToast";
import { Icon } from "@spora-ai/components/icons";
import ApiKeyCreateModal from "./ApiKeyCreateModal.vue";
import ApiKeyRevealModal from "./ApiKeyRevealModal.vue";
import { useAgentApiKeysStore } from "@/stores/agentApiKeys";

const props = defineProps<{ agentId: number }>();

const store = useAgentApiKeysStore();
const toast = useToast();
const { confirm } = useConfirmDialog();

const showCreate = ref(false);
const showReveal = ref(false);

// Watched rather than `onMounted`: the route is param-only, so navigating
// `/agents/7/api-keys` → `/agents/8/api-keys` reuses this component and
// would otherwise render agent 7's key names under agent 8's heading.
watch(
  () => props.agentId,
  async (agentId) => {
    try {
      await store.fetchKeys(agentId);
    } catch {
      // The store records the message; the alert below renders it.
    }
  },
  { immediate: true },
);

async function onCreate(name: string): Promise<void> {
  try {
    await store.createKey(props.agentId, { name });
    showCreate.value = false;
    showReveal.value = true;
  } catch {
    toast.error("Could not create the API key.");
  }
}

function onRevealClosed(): void {
  showReveal.value = false;
  store.clearSecret();
}

/**
 * Backstops the reveal-once contract against every path that could leave the
 * plaintext in the store: a dismissal the dialog did not report, a route
 * change, the tab closing. The dialog's own `close` emit is the normal route;
 * these make the guarantee a property of this component rather than of one
 * button.
 */
watch(showReveal, (open) => {
  if (!open) store.clearSecret();
});

onBeforeUnmount(() => {
  store.clearSecret();
});

async function onDelete(key: AgentApiKey): Promise<void> {
  const confirmed = await confirm(
    `Revoke "${key.name}"? Anything using it will start getting 401 responses. This cannot be undone.`,
    "Revoke API key",
    "Revoke",
  );

  if (!confirmed) return;

  try {
    await store.deleteKey(props.agentId, key.id);
    toast.success("API key revoked");
  } catch {
    toast.error("Could not revoke the API key.");
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <!-- Heading and explanation belong to AgentApiKeysSection; repeated
           here they rendered "API keys" twice on the page. -->
      <button
        data-testid="new-api-key"
        class="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        type="button"
        @click="showCreate = true"
      >
        New key
      </button>
    </div>

    <p
      v-if="store.error"
      role="alert"
      class="text-sm text-destructive"
      data-testid="api-keys-error"
    >
      {{ store.error }}
    </p>

    <!--
      The alert is a sibling of the list, not the alternative to it. Chaining
      it with `v-else` meant a failed revoke replaced the whole table with the
      error, hiding the keys the operator needed in order to retry — and
      `store.error` only clears on the next successful action.
    -->
    <p
      v-if="!store.loading && store.keys.length === 0"
      class="text-sm text-muted-foreground"
    >
      No API keys yet.
    </p>

    <table
      v-if="store.keys.length > 0"
      class="w-full text-sm"
    >
      <thead class="bg-muted/40">
        <tr>
          <th class="px-3 py-2 text-left font-medium text-muted-foreground">
            Name
          </th>
          <th class="px-3 py-2 text-left font-medium text-muted-foreground">
            Created
          </th>
          <th class="px-3 py-2 text-left font-medium text-muted-foreground">
            Last used
          </th>
          <th class="px-3 py-2" />
        </tr>
      </thead>
      <tbody class="divide-y divide-border">
        <tr
          v-for="key in store.keys"
          :key="key.id"
          :data-testid="`api-key-row-${key.id}`"
        >
          <td class="px-3 py-2 text-foreground">
            {{ key.name }}
          </td>
          <td class="px-3 py-2 text-muted-foreground">
            {{ formatDate(key.created_at) }}
          </td>
          <td class="px-3 py-2 text-muted-foreground">
            {{ formatDate(key.last_used_at) }}
          </td>
          <td class="px-3 py-2 text-right">
            <button
              :data-testid="`revoke-api-key-${key.id}`"
              class="rounded-lg px-2 py-1 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              type="button"
              :aria-label="`Revoke ${key.name}`"
              @click="onDelete(key)"
            >
              <Icon
                name="trash"
                class="h-4 w-4"
              />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <ApiKeyCreateModal
      v-model="showCreate"
      :saving="store.saving"
      @create="onCreate"
      @close="showCreate = false"
    />

    <ApiKeyRevealModal
      v-if="store.lastCreatedSecret"
      v-model="showReveal"
      :secret="store.lastCreatedSecret"
      @close="onRevealClosed"
    />
  </section>
</template>
