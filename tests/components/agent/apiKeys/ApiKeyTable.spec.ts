import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import ApiKeyTable from "@/components/agent/apiKeys/ApiKeyTable.vue";
import { useAgentApiKeysStore } from "@/stores/agentApiKeys";

vi.mock("@/api/agentApiKeys", () => ({
  agentApiKeysApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

import { agentApiKeysApi } from "@/api/agentApiKeys";

const mockApi = agentApiKeysApi as unknown as {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};
const confirmMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

const key = {
  id: "abc123",
  agent_id: 7,
  name: "n8n",
  last_used_at: null,
  created_at: "2026-10-01T08:00:00Z",
};

function render() {
  return mount(ApiKeyTable, {
    props: { agentId: 7 },
    global: {
      stubs: {
        Icon: true,
        ApiKeyCreateModal: true,
        ApiKeyRevealModal: true,
      },
    },
  });
}

describe("ApiKeyTable", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockApi.list.mockResolvedValue([key]);
  });

  it("lists the agent's keys on mount", async () => {
    const wrapper = render();
    await flushPromises();

    expect(mockApi.list).toHaveBeenCalledWith(7);
    expect(wrapper.get(`[data-testid="api-key-row-abc123"]`).text()).toContain(
      "n8n",
    );
  });

  it("says so when there are none", async () => {
    mockApi.list.mockResolvedValue([]);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("No API keys yet");
  });

  it("never renders a secret in the table", async () => {
    mockApi.list.mockResolvedValue([{ ...key, secret: "spk_leaked" } as never]);
    const wrapper = render();
    await flushPromises();

    // Defence in depth: the server never sends one, and if it ever did the
    // list must not put it on screen.
    expect(wrapper.text()).not.toContain("spk_leaked");
  });

  it('shows "Never" for a key that has not been used', async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Never");
  });

  it("revokes only after the operator confirms", async () => {
    confirmMock.mockResolvedValue(false);
    mockApi.remove.mockResolvedValue(undefined);

    const wrapper = render();
    await flushPromises();

    await wrapper.get('[data-testid="revoke-api-key-abc123"]').trigger("click");

    expect(mockApi.remove).not.toHaveBeenCalled();
  });

  it("revokes and drops the row once confirmed", async () => {
    confirmMock.mockResolvedValue(true);
    mockApi.remove.mockResolvedValue(undefined);

    const wrapper = render();
    await flushPromises();

    await wrapper.get('[data-testid="revoke-api-key-abc123"]').trigger("click");
    await flushPromises();

    expect(mockApi.remove).toHaveBeenCalledWith(7, "abc123");
    expect(wrapper.find('[data-testid="api-key-row-abc123"]').exists()).toBe(
      false,
    );
    expect(toastSuccess).toHaveBeenCalledWith("API key revoked");
  });

  it("keeps the key list visible when an action fails", async () => {
    // `store.error` chained with `v-else` replaced the whole table with the
    // error, hiding the keys the operator needs in order to retry — and the
    // error only clears on the next successful action or a remount.
    confirmMock.mockResolvedValue(true);
    mockApi.remove.mockRejectedValue(new Error("nope"));

    const wrapper = render();
    await flushPromises();

    await wrapper.get('[data-testid="revoke-api-key-abc123"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="api-keys-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="api-key-row-abc123"]').exists()).toBe(
      true,
    );
  });

  it("refetches when the agent id changes", async () => {
    // The route is param-only, so the component is reused across agents and
    // would otherwise render one agent's keys under another's heading.
    const wrapper = render();
    await flushPromises();
    expect(mockApi.list).toHaveBeenCalledWith(7);

    await wrapper.setProps({ agentId: 8 });

    expect(mockApi.list).toHaveBeenLastCalledWith(8);
  });

  it("surfaces a load failure rather than an empty table", async () => {
    mockApi.list.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();

    expect(wrapper.get('[data-testid="api-keys-error"]').exists()).toBe(true);
  });

  describe("creating a key", () => {
    // The modals are stubbed above, so this asserts the orchestration the
    // table owns: close the create dialog, open the reveal one, and only
    // clear the stored secret once the operator has seen it.

    function renderFlow() {
      return mount(ApiKeyTable, {
        props: { agentId: 7 },
        global: {
          stubs: {
            Icon: true,
            ApiKeyCreateModal: {
              name: "ApiKeyCreateModal",
              props: ["modelValue", "saving"],
              emits: ["create", "close", "update:modelValue"],
              template: "<div />",
            },
            ApiKeyRevealModal: {
              name: "ApiKeyRevealModal",
              props: ["modelValue", "secret"],
              emits: ["close", "update:modelValue"],
              template: '<div class="reveal-modal-stub" />',
            },
          },
        },
      });
    }

    it("reveals the new secret once the create dialog closes", async () => {
      mockApi.create.mockResolvedValue({ key, secret: "spk_abc_fresh" });

      const wrapper = renderFlow();
      await flushPromises();

      const create = wrapper.findComponent({ name: "ApiKeyCreateModal" });
      const reveal = wrapper.findComponent({ name: "ApiKeyRevealModal" });

      expect(reveal.exists()).toBe(false);

      await create.vm.$emit("create", "n8n");
      await flushPromises();

      // The dialog must already be mounted when it opens: the secret lives
      // in the store and is cleared on close, so rendering it only on open
      // would race the clear.
      expect(
        wrapper.findComponent({ name: "ApiKeyRevealModal" }).exists(),
      ).toBe(true);
      expect(
        wrapper.findComponent({ name: "ApiKeyRevealModal" }).props("secret"),
      ).toBe("spk_abc_fresh");
      expect(wrapper.find(".reveal-modal-stub").exists()).toBe(true);
    });

    it("clears the secret only once the reveal dialog is closed", async () => {
      mockApi.create.mockResolvedValue({ key, secret: "spk_abc_fresh" });

      const wrapper = renderFlow();
      await flushPromises();

      await wrapper
        .findComponent({ name: "ApiKeyCreateModal" })
        .vm.$emit("create", "n8n");
      await flushPromises();

      const store = useAgentApiKeysStore();
      expect(store.lastCreatedSecret).toBe("spk_abc_fresh");

      await wrapper
        .findComponent({ name: "ApiKeyRevealModal" })
        .vm.$emit("close");
      await flushPromises();

      expect(store.lastCreatedSecret).toBeNull();
      expect(
        wrapper.findComponent({ name: "ApiKeyRevealModal" }).exists(),
      ).toBe(false);
    });

    it("keeps the create dialog open and reports when minting fails", async () => {
      mockApi.create.mockRejectedValue(new Error("nope"));

      const wrapper = renderFlow();
      await flushPromises();

      await wrapper.get('[data-testid="new-api-key"]').trigger("click");
      await flushPromises();

      const create = wrapper.findComponent({ name: "ApiKeyCreateModal" });
      expect(create.props("modelValue")).toBe(true);

      await create.vm.$emit("create", "n8n");
      await flushPromises();

      // Closing the dialog here would discard the name and read as a
      // success, which is how an operator ends up minting duplicates.
      expect(
        wrapper
          .findComponent({ name: "ApiKeyCreateModal" })
          .props("modelValue"),
      ).toBe(true);
      expect(
        wrapper.findComponent({ name: "ApiKeyRevealModal" }).exists(),
      ).toBe(false);
      expect(toastError).toHaveBeenCalledWith("Could not create the API key.");
    });

    it("closes the create dialog once the key is minted", async () => {
      mockApi.create.mockResolvedValue({ key, secret: "spk_abc_fresh" });

      const wrapper = renderFlow();
      await flushPromises();

      await wrapper.get('[data-testid="new-api-key"]').trigger("click");
      await flushPromises();

      const create = wrapper.findComponent({ name: "ApiKeyCreateModal" });
      await create.vm.$emit("create", "n8n");
      await flushPromises();

      expect(
        wrapper
          .findComponent({ name: "ApiKeyCreateModal" })
          .props("modelValue"),
      ).toBe(false);
      expect(
        wrapper.findComponent({ name: "ApiKeyRevealModal" }).exists(),
      ).toBe(true);
    });

    it("passes the saving flag through so the button can be disabled", async () => {
      const wrapper = renderFlow();
      await flushPromises();

      expect(
        wrapper.findComponent({ name: "ApiKeyCreateModal" }).props("saving"),
      ).toBe(false);
    });
  });
});
