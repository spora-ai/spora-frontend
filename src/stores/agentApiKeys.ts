import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError } from "@/api/client";
import { agentApiKeysApi } from "@/api/agentApiKeys";
import { i18n } from "@/i18n";
import type {
  AgentApiKey,
  CreateAgentApiKeyPayload,
} from "@/types/agentApiKey";

/**
 * agentApiKeys store — an agent's Agent API credentials.
 *
 * `lastCreatedSecret` holds a plaintext secret for exactly as long as the
 * reveal dialog is open, and is cleared by `clearSecret()`. Nothing here
 * re-fetches it, because the server cannot return it a second time — only a
 * SHA-256 digest is stored. `ApiKeyTable` owns the calls into `clearSecret()`.
 */

export const useAgentApiKeysStore = defineStore("agentApiKeys", () => {
  const keys = ref<AgentApiKey[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  /** Plaintext secret from the last successful create, awaiting display. */
  const lastCreatedSecret = ref<string | null>(null);

  async function fetchKeys(agentId: number): Promise<AgentApiKey[]> {
    loading.value = true;
    error.value = null;
    try {
      keys.value = await agentApiKeysApi.list(agentId);
      return keys.value;
    } catch (e) {
      error.value =
        e instanceof ApiError ? e.message : i18n.global.t("Failed to load API keys.");
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function createKey(
    agentId: number,
    payload: CreateAgentApiKeyPayload,
  ): Promise<AgentApiKey> {
    saving.value = true;
    error.value = null;
    try {
      const created = await agentApiKeysApi.create(agentId, payload);
      keys.value = [created.key, ...keys.value];
      lastCreatedSecret.value = created.secret;
      return created.key;
    } catch (e) {
      error.value =
        e instanceof ApiError ? e.message : i18n.global.t("Failed to create API key.");
      throw e;
    } finally {
      saving.value = false;
    }
  }

  async function deleteKey(agentId: number, keyId: string): Promise<void> {
    saving.value = true;
    error.value = null;
    try {
      await agentApiKeysApi.remove(agentId, keyId);
      keys.value = keys.value.filter((k) => k.id !== keyId);
    } catch (e) {
      error.value =
        e instanceof ApiError ? e.message : i18n.global.t("Failed to revoke API key.");
      throw e;
    } finally {
      saving.value = false;
    }
  }

  function clearSecret(): void {
    lastCreatedSecret.value = null;
  }

  return {
    keys,
    loading,
    saving,
    error,
    lastCreatedSecret,
    fetchKeys,
    createKey,
    deleteKey,
    clearSecret,
  };
});
