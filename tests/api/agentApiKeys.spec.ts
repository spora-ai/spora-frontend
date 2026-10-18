import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";
import { agentApiKeysApi } from "@/api/agentApiKeys";

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("agentApiKeysApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps the key list", async () => {
    const keys = [
      {
        id: "abc",
        agent_id: 7,
        name: "n8n",
        last_used_at: null,
        created_at: null,
      },
    ];
    mockApi.get.mockResolvedValue({ keys });

    await expect(agentApiKeysApi.list(7)).resolves.toEqual(keys);
    expect(mockApi.get).toHaveBeenCalledWith("/agents/7/api-keys");
  });

  it("returns the secret the create call carries", async () => {
    const key = {
      id: "abc",
      agent_id: 7,
      name: "n8n",
      last_used_at: null,
      created_at: null,
    };
    mockApi.post.mockResolvedValue({ key, secret: "spk_abc_x" });

    await expect(agentApiKeysApi.create(7, { name: "n8n" })).resolves.toEqual({
      key,
      secret: "spk_abc_x",
    });
    expect(mockApi.post).toHaveBeenCalledWith("/agents/7/api-keys", {
      name: "n8n",
    });
  });

  it("encodes the key id into the revoke path", async () => {
    // The id is server-generated hex, but encoding costs nothing and keeps a
    // malformed value from changing the path's shape.
    mockApi.delete.mockResolvedValue(undefined);

    await agentApiKeysApi.remove(7, "a/b c");

    expect(mockApi.delete).toHaveBeenCalledWith("/agents/7/api-keys/a%2Fb%20c");
  });
});
