import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError } from "@/api/client";
import { apiKeysApi } from "@/api/apiKeys";
import { i18n } from "@/i18n";
import type {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyPayload,
} from "@/types/apiKey";

/**
 * apiKeys store — the API credentials of one scope.
 *
 * `lastCreatedSecret` holds a plaintext secret for exactly as long as the
 * reveal dialog is open, and is cleared by `clearSecret()`. Nothing here
 * re-fetches it, because the server cannot return it a second time — only a
 * SHA-256 digest is stored. `ApiKeyTable` owns the calls into `clearSecret()`.
 *
 * One store serves the three scopes: only one of them is on screen at a
 * time, and every fetch replaces the list rather than adding to it.
 */

export const useApiKeysStore = defineStore("apiKeys", () => {
  const keys = ref<ApiKey[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  /** Plaintext secret from the last successful create, awaiting display. */
  const lastCreatedSecret = ref<string | null>(null);

  async function fetchKeys(
    scope: ApiKeyScope,
    targetId: number | null,
  ): Promise<ApiKey[]> {
    loading.value = true;
    error.value = null;
    try {
      keys.value = await apiKeysApi.list(scope, targetId);
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
    scope: ApiKeyScope,
    targetId: number | null,
    payload: CreateApiKeyPayload,
  ): Promise<ApiKey> {
    saving.value = true;
    error.value = null;
    try {
      const created = await apiKeysApi.create(scope, targetId, payload);
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

  async function deleteKey(
    scope: ApiKeyScope,
    targetId: number | null,
    keyId: string,
  ): Promise<void> {
    saving.value = true;
    error.value = null;
    try {
      await apiKeysApi.remove(scope, targetId, keyId);
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
