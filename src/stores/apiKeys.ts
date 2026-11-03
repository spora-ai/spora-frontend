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
 * time. The list belongs to the scope it was fetched for — `loadedFor` says
 * whose — so a fetch for another scope replaces the list rather than adding
 * to it.
 */

export const useApiKeysStore = defineStore("apiKeys", () => {
  const keys = ref<ApiKey[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  /** Plaintext secret from the last successful create, awaiting display. */
  const lastCreatedSecret = ref<string | null>(null);

  /**
   * The scope and target the rows in `keys` belong to.
   *
   * One store serves the three scopes, so the list has to carry whose rows it
   * holds: rows fetched for one scope and shown under another's heading would
   * read as keys of a scope they are not.
   */
  const loadedFor = ref<{
    scope: ApiKeyScope;
    targetId: number | null;
  } | null>(null);

  /** Counts the fetches, so a response that lost the race is discarded. */
  let requestCount = 0;

  function isSameTarget(
    target: { scope: ApiKeyScope; targetId: number | null } | null,
    scope: ApiKeyScope,
    targetId: number | null,
  ): boolean {
    return (
      target !== null &&
      target.scope === scope &&
      target.targetId === targetId
    );
  }

  async function fetchKeys(
    scope: ApiKeyScope,
    targetId: number | null,
  ): Promise<ApiKey[]> {
    const request = ++requestCount;
    loading.value = true;
    error.value = null;
    // Another scope's rows cannot stay on screen under this scope's heading.
    // A fetch that then fails leaves nothing to show rather than the rows of
    // the scope the operator just left.
    if (!isSameTarget(loadedFor.value, scope, targetId)) {
      keys.value = [];
      loadedFor.value = null;
    }
    try {
      const fetched = await apiKeysApi.list(scope, targetId);
      // A newer fetch has taken the list over; this response belongs to a
      // scope nobody is looking at any more.
      if (request !== requestCount) return fetched;
      keys.value = fetched;
      loadedFor.value = { scope, targetId };
      return fetched;
    } catch (e) {
      if (request === requestCount) {
        error.value =
          e instanceof ApiError ? e.message : i18n.global.t("Failed to load API keys.");
      }
      throw e;
    } finally {
      if (request === requestCount) loading.value = false;
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
      // A key minted for another scope cannot join the list: the list is
      // emptied rather than mixed.
      if (!isSameTarget(loadedFor.value, scope, targetId)) {
        keys.value = [];
        loadedFor.value = { scope, targetId };
      }
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
