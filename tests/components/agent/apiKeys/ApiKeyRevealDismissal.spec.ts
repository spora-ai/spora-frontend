/**
 * The reveal-once contract: a plaintext key must not outlive its dialog.
 *
 * Both dismissal routes matter. `Modal`'s header X calls its own `close()`,
 * which emits `update:modelValue` *and* `close`, while the backdrop is
 * disabled on this dialog. A wrapper forwarding only the v-model event
 * therefore hides the dialog and leaves the plaintext in the store for the
 * rest of the session, with no way left to reach it — and the server cannot
 * reproduce it, so the operator is left with a live key they do not hold.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import ApiKeyRevealModal from "@/components/agent/apiKeys/ApiKeyRevealModal.vue";
import ApiKeyTable from "@/components/agent/apiKeys/ApiKeyTable.vue";
import { useAgentApiKeysStore } from "@/stores/agentApiKeys";
import { agentApiKeysApi } from "@/api/agentApiKeys";

vi.mock("@/api/agentApiKeys", () => ({
  agentApiKeysApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

/**
 * Models `Modal`'s real dismiss behaviour: its `close()` emits
 * `update:modelValue(false)` *and then* `close`, on both the header X and the
 * backdrop. A stub that emitted only one of them would let the wrapper drop the
 * other without the test noticing — which is the bug this file exists for.
 *
 * Note what is deliberately absent: `Modal` registers no key handler at all,
 * so Esc closes nothing in this app. The dialog holding a plaintext key has no
 * Esc affordance and no focus trap, which is worth knowing before anyone adds
 * a second one.
 */
const modalStub = defineComponent({
  name: "Modal",
  props: ["modelValue"],
  emits: ["update:modelValue", "close"],
  methods: {
    close() {
      this.$emit("update:modelValue", false);
      this.$emit("close");
    },
  },
  template: `
    <div>
      <button data-testid="dismiss" @click="close" />
      <slot />
      <slot name="footer" />
    </div>
  `,
});

function renderModal(secret: string | null = "spk_abc_def") {
  return mount(ApiKeyRevealModal, {
    props: { modelValue: true, secret },
    global: { stubs: { Modal: modalStub } },
  });
}

const CREATED = {
  key: {
    id: "abc",
    agent_id: 7,
    name: "n8n",
    last_used_at: null,
    created_at: null,
  },
  secret: "spk_abc_fresh",
};

/**
 * Mount the table, mint a key, and return the wrapper with the reveal dialog
 * open — the state where the plaintext is live.
 */
async function tableWithFreshKey(revealEmits: string[] = ["close"]) {
  vi.mocked(agentApiKeysApi.create).mockResolvedValue(CREATED);

  const wrapper = mount(ApiKeyTable, {
    props: { agentId: 7 },
    global: {
      stubs: {
        Icon: true,
        ApiKeyCreateModal: true,
        ApiKeyRevealModal: {
          name: "ApiKeyRevealModal",
          props: ["modelValue", "secret"],
          emits: revealEmits,
          template: "<div />",
        },
      },
    },
  });

  await wrapper
    .findComponent({ name: "ApiKeyCreateModal" })
    .vm.$emit("create", "n8n");
  await flushPromises();

  return wrapper;
}

describe("ApiKeyRevealModal dismissal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("shows the plaintext secret", () => {
    expect(renderModal().get('[data-testid="api-key-secret"]').text()).toBe(
      "spk_abc_def",
    );
  });

  it("emits close on a header-X dismissal", async () => {
    // Without this the parent never clears the stored secret: the dialog
    // hides, the plaintext stays for the rest of the session.
    const wrapper = renderModal();

    await wrapper.get('[data-testid="dismiss"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close from the acknowledgement button", async () => {
    const wrapper = renderModal();

    await wrapper.get('[data-testid="acknowledge-api-key"]').trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("copies the secret to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const wrapper = renderModal();
    await wrapper.get('[data-testid="copy-api-key"]').trigger("click");

    expect(writeText).toHaveBeenCalledWith("spk_abc_def");
    expect(wrapper.get('[data-testid="copy-api-key"]').text()).toBe("Copied");
  });

  it("keeps the value on screen when the clipboard is refused", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    const wrapper = renderModal();
    await wrapper.get('[data-testid="copy-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="api-key-secret"]').text()).toBe(
      "spk_abc_def",
    );
  });
});

describe("AgentApiKeys secret lifecycle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("drops the secret when the dialog reports a close", async () => {
    const wrapper = await tableWithFreshKey();

    expect(useAgentApiKeysStore().lastCreatedSecret).toBe("spk_abc_fresh");

    await wrapper
      .findComponent({ name: "ApiKeyRevealModal" })
      .vm.$emit("close");
    await flushPromises();

    expect(useAgentApiKeysStore().lastCreatedSecret).toBeNull();
  });

  it("drops the secret even if the dialog only reports through v-model", async () => {
    // A dialog that emits only `update:modelValue` is the exact shape that
    // leaked the plaintext. The table must not depend on the child to be
    // thorough.
    const wrapper = await tableWithFreshKey(["update:modelValue"]);

    await wrapper
      .findComponent({ name: "ApiKeyRevealModal" })
      .vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(useAgentApiKeysStore().lastCreatedSecret).toBeNull();
  });

  it("drops the secret when the table unmounts with the dialog open", async () => {
    // Navigating away mid-reveal must not leave the plaintext behind.
    const wrapper = await tableWithFreshKey();
    expect(useAgentApiKeysStore().lastCreatedSecret).toBe("spk_abc_fresh");

    wrapper.unmount();

    expect(useAgentApiKeysStore().lastCreatedSecret).toBeNull();
  });
});
