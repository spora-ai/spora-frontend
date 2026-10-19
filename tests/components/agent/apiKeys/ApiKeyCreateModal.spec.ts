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

  it("does not emit a second create while one is in flight", async () => {
    // The name input stays enabled while the parent saves, so a second Enter
    // reaches submit. Two mints mean two server rows and two plaintexts, and
    // the store keeps only the last — leaving the first key live with a secret
    // nobody holds and no way to recover it.
    const wrapper = render({ saving: true });

    await wrapper.get('[data-testid="api-key-name"]').setValue("n8n");

    // Implicit submission, i.e. Enter in the text field. This bypasses the
    // disabled footer button entirely, which is why the button's `disabled`
    // binding is not a fix on its own.
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("create")).toBeUndefined();
  });

  it("emits create again once the in-flight one has finished", async () => {
    // The guard is on the in-flight state, not on having emitted once — a
    // second, deliberate key must still be mintable.
    const wrapper = render();

    await wrapper.get('[data-testid="api-key-name"]').setValue("n8n");
    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ saving: true });

    await wrapper.get('[data-testid="create-api-key"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("create")).toHaveLength(1);
  });
});
