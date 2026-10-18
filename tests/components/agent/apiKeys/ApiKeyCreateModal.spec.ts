import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import ApiKeyCreateModal from "@/components/agent/apiKeys/ApiKeyCreateModal.vue";

function render(props: Record<string, unknown> = {}) {
  return mount(ApiKeyCreateModal, {
    props: { modelValue: true, ...props },
    global: {
      stubs: {
        Modal: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  });
}

describe("ApiKeyCreateModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("refuses an empty name", async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "A name is required",
    );
    expect(wrapper.emitted("create")).toBeUndefined();
  });

  it("emits the trimmed name", async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="api-key-name"]').setValue("  n8n  ");
    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("create")).toEqual([["n8n"]]);
  });

  it("clears the error once a name is typed", async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);

    await wrapper.get('[data-testid="api-key-name"]').setValue("n");
    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("caps the name at the server-side limit", () => {
    const wrapper = render();

    // The server rejects over 100 characters with a 422; the input makes
    // that unreachable rather than merely unlikely.
    expect(
      wrapper.get('[data-testid="api-key-name"]').attributes("maxlength"),
    ).toBe("100");
  });

  it("disables the submit button while saving", () => {
    const wrapper = render({ saving: true });

    expect(
      wrapper.get('[data-testid="create-api-key"]').attributes("disabled"),
    ).toBeDefined();
  });
});
