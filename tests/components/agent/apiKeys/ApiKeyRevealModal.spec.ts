import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeyRevealModal from "@/components/agent/apiKeys/ApiKeyRevealModal.vue";

/**
 * The reveal-once contract is the one thing this dialog has to get right:
 * the plaintext is unrecoverable after this, so the value must be on screen
 * and copyable, and must not be re-fetchable.
 */
describe("ApiKeyRevealModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the plaintext secret", async () => {
    const wrapper = mount(ApiKeyRevealModal, {
      props: { modelValue: true, secret: "spk_abc_def" },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    });

    expect(wrapper.get('[data-testid="api-key-secret"]').text()).toBe(
      "spk_abc_def",
    );
  });

  it("copies the secret to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const wrapper = mount(ApiKeyRevealModal, {
      props: { modelValue: true, secret: "spk_abc_def" },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    });

    await wrapper.get('[data-testid="copy-api-key"]').trigger("click");

    expect(writeText).toHaveBeenCalledWith("spk_abc_def");
    expect(wrapper.get('[data-testid="copy-api-key"]').text()).toBe("Copied");
  });

  it("keeps the value on screen when the clipboard is refused", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    const wrapper = mount(ApiKeyRevealModal, {
      props: { modelValue: true, secret: "spk_abc_def" },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    });

    await wrapper.get('[data-testid="copy-api-key"]').trigger("click");
    await flushPromises();

    // Clearing the secret on a copy failure would lose the only copy.
    expect(wrapper.get('[data-testid="api-key-secret"]').text()).toBe(
      "spk_abc_def",
    );
  });

  it("says so when the clipboard is refused, so the operator does not dismiss the key", async () => {
    // A silent failure leaves the operator clicking "I've saved it"
    // believing the key was copied — and the key is unrecoverable.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    const wrapper = mount(ApiKeyRevealModal, {
      props: { modelValue: true, secret: "spk_abc_def" },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    });

    expect(wrapper.find('[data-testid="copy-api-key-failed"]').exists()).toBe(
      false,
    );

    await wrapper.get('[data-testid="copy-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="copy-api-key-failed"]').text()).toBe(
      "Copy failed — select the key manually",
    );
    expect(wrapper.get('[data-testid="copy-api-key"]').text()).toBe(
      "Copy to clipboard",
    );
  });

  it("emits close so the caller can clear the stored secret", async () => {
    const wrapper = mount(ApiKeyRevealModal, {
      props: { modelValue: true, secret: "spk_abc_def" },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    });

    await wrapper.get('[data-testid="acknowledge-api-key"]').trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
