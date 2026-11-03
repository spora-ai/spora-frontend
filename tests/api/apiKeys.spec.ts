import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";
import { apiKeysApi } from "@/api/apiKeys";

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const key = {
  id: "abc",
  scope: "agent" as const,
  agent_id: 7,
  group_id: null,
  name: "n8n",
  last_used_at: null,
  created_at: null,
};

describe("apiKeysApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps the key list", async () => {
    const keys = [key];
    mockApi.get.mockResolvedValue({ keys });

    await expect(apiKeysApi.list("agent", 7)).resolves.toEqual(keys);
    expect(mockApi.get).toHaveBeenCalledWith("/agents/7/api-keys");
  });

  it("lists a group's keys from the group's own collection", async () => {
    mockApi.get.mockResolvedValue({ keys: [] });

    await apiKeysApi.list("group", 3);

    expect(mockApi.get).toHaveBeenCalledWith("/groups/3/api-keys");
  });

  it("lists the global keys from a collection of their own", async () => {
    // The global scope has no target, so it gets its own collection rather
    // than a target id the server would ignore.
    mockApi.get.mockResolvedValue({ keys: [] });

    await apiKeysApi.list("global", null);

    expect(mockApi.get).toHaveBeenCalledWith("/global-api-keys");
  });

  it("returns the secret the create call carries", async () => {
    mockApi.post.mockResolvedValue({ key, secret: "spk_abc_x" });

    await expect(apiKeysApi.create("agent", 7, { name: "n8n" })).resolves.toEqual({
      key,
      secret: "spk_abc_x",
    });
    expect(mockApi.post).toHaveBeenCalledWith("/agents/7/api-keys", {
      name: "n8n",
    });
  });

  it("mints a group key in the group's collection", async () => {
    mockApi.post.mockResolvedValue({ key, secret: "spk_abc_x" });

    await apiKeysApi.create("group", 3, { name: "n8n" });

    expect(mockApi.post).toHaveBeenCalledWith("/groups/3/api-keys", {
      name: "n8n",
    });
  });

  it("encodes the key id into the revoke path", async () => {
    // The id is server-generated hex, but encoding costs nothing and keeps a
    // malformed value from changing the path's shape.
    mockApi.delete.mockResolvedValue(undefined);

    await apiKeysApi.remove("agent", 7, "a/b c");

    expect(mockApi.delete).toHaveBeenCalledWith("/agents/7/api-keys/a%2Fb%20c");
  });

  it("revokes a global key from the global collection", async () => {
    mockApi.delete.mockResolvedValue(undefined);

    await apiKeysApi.remove("global", null, "abc");

    expect(mockApi.delete).toHaveBeenCalledWith("/global-api-keys/abc");
  });
});
