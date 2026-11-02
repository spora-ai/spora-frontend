import { setActivePinia, createPinia } from "pinia";
import { useApiKeysStore } from "@/stores/apiKeys";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/apiKeys", () => ({
  apiKeysApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

import { apiKeysApi } from "@/api/apiKeys";

const mockApi = apiKeysApi as unknown as {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

const key = {
  id: "abc123",
  scope: "agent" as const,
  agent_id: 7,
  group_id: null,
  name: "n8n",
  last_used_at: null,
  created_at: "2026-10-01T08:00:00Z",
};

describe("apiKeys store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads the agent's keys", async () => {
    mockApi.list.mockResolvedValue([key]);
    const store = useApiKeysStore();

    await expect(store.fetchKeys("agent", 7)).resolves.toEqual([key]);
    expect(mockApi.list).toHaveBeenCalledWith("agent", 7);
    expect(store.keys).toHaveLength(1);
    expect(store.error).toBeNull();
  });

  it("loads a group's keys", async () => {
    mockApi.list.mockResolvedValue([]);
    const store = useApiKeysStore();

    await store.fetchKeys("group", 3);

    expect(mockApi.list).toHaveBeenCalledWith("group", 3);
  });

  it("records the message when the list fails and rethrows", async () => {
    mockApi.list.mockRejectedValue(new Error("boom"));
    const store = useApiKeysStore();

    await expect(store.fetchKeys("agent", 7)).rejects.toThrow();
    expect(store.error).toBe("Failed to load API keys.");
  });

  it("holds the plaintext secret until it is cleared", async () => {
    mockApi.create.mockResolvedValue({ key, secret: "spk_abc_secret" });
    const store = useApiKeysStore();

    await store.createKey("agent", 7, { name: "n8n" });

    // The reveal dialog reads this. It is the only copy that will ever
    // exist — the server cannot reproduce it.
    expect(store.lastCreatedSecret).toBe("spk_abc_secret");
    expect(store.keys[0].id).toBe("abc123");

    store.clearSecret();
    expect(store.lastCreatedSecret).toBeNull();
  });

  it("never puts a secret on the key object", async () => {
    mockApi.list.mockResolvedValue([key]);
    mockApi.create.mockResolvedValue({ key, secret: "spk_abc_secret" });
    const store = useApiKeysStore();

    await store.fetchKeys("agent", 7);
    await store.createKey("agent", 7, { name: "n8n" });

    // `ApiKey` has no secret field; if a response ever grew one it must
    // not start being persisted into the list the table renders.
    for (const k of store.keys) {
      expect(Object.keys(k)).not.toContain("secret");
    }
  });

  it("removes a revoked key from the list", async () => {
    mockApi.list.mockResolvedValue([key]);
    mockApi.remove.mockResolvedValue(undefined);
    const store = useApiKeysStore();

    await store.fetchKeys("agent", 7);
    await store.deleteKey("agent", 7, "abc123");

    expect(mockApi.remove).toHaveBeenCalledWith("agent", 7, "abc123");
    expect(store.keys).toHaveLength(0);
  });

  it("leaves the list intact when a revoke fails", async () => {
    mockApi.list.mockResolvedValue([key]);
    mockApi.remove.mockRejectedValue(new Error("nope"));
    const store = useApiKeysStore();

    await store.fetchKeys("agent", 7);
    await expect(store.deleteKey("agent", 7, "abc123")).rejects.toThrow();

    // Optimistically dropping the row on failure would hide a key that is
    // still live.
    expect(store.keys).toHaveLength(1);
    expect(store.error).toBe("Failed to revoke API key.");
  });
});
