/**
 * AgentApiKeysPage — the agent's key management surface.
 *
 * The behaviour worth pinning is the client-worker warning: the page is
 * reachable with `SPORA_AGENT_API` on in client-worker mode, so it has to
 * say the endpoints will 404 rather than looking broken.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "7" } }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: "RouterLink", template: "<a><slot /></a>" },
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const workerRuntimeMode = ref<"server" | "client">("server");
const agentApiEnabled = ref(true);
vi.mock("@/stores/runtimeConfig", () => ({
  useRuntimeConfigStore: () => ({
    get workerRuntimeMode() {
      return workerRuntimeMode.value;
    },
  }),
}));

const currentAgent = ref<{ id: number } | null>({ id: 7 });
vi.mock("@/composables/useFeatureEnabled", () => ({
  useFeatureEnabled: () => ({
    get value() {
      return agentApiEnabled.value;
    },
  }),
}));

vi.mock("@/stores/agent", () => ({
  useAgentStore: () => ({
    get currentAgent() {
      return currentAgent.value;
    },
    fetchAgents: vi.fn(),
    fetchAgent: vi.fn(),
  }),
}));

import AgentApiKeysPage from "@/pages/AgentApiKeysPage.vue";

function render() {
  return mount(AgentApiKeysPage, {
    global: {
      stubs: {
        AgentLayout: { template: "<div><slot /></div>" },
        ApiKeyTable: { template: '<div class="api-key-table-stub" />' },
      },
    },
  });
}

describe("AgentApiKeysPage", () => {
  beforeEach(() => {
    workerRuntimeMode.value = "server";
    agentApiEnabled.value = true;
    currentAgent.value = { id: 7 };
    vi.clearAllMocks();
  });

  it("renders the key table once the agent is loaded", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find(".api-key-table-stub").exists()).toBe(true);
  });

  it("shows a loading state before the agent arrives", async () => {
    currentAgent.value = null;

    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Loading");
    expect(wrapper.find(".api-key-table-stub").exists()).toBe(false);
  });

  it("says nothing about the worker while the instance runs a server worker", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).not.toContain("client-worker mode");
  });

  it("warns in client-worker mode rather than hiding the page", async () => {
    workerRuntimeMode.value = "client";

    const wrapper = render();
    await flushPromises();

    // The tab is gated on the setting alone, so the page is reachable here.
    // What it must not do is look like a working API: an operator who
    // enabled the feature needs to know the endpoints will 404, why, and
    // that their existing keys are still good.
    expect(wrapper.text()).toContain("client-worker mode");
    expect(wrapper.text()).toContain("404");
    expect(wrapper.text()).toContain("still yours to list and revoke");
    expect(wrapper.find(".api-key-table-stub").exists()).toBe(true);
  });

  it("explains the 404 when reached by URL with the feature off", async () => {
    // The route is reachable with the setting off on purpose, so an operator
    // can still revoke what they minted. Landing here with no tab and no
    // message would leave them unable to tell why their keys do not work.
    agentApiEnabled.value = false;

    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Agent API");
    expect(wrapper.text()).toContain("404");
    expect(wrapper.find(".api-key-table-stub").exists()).toBe(true);
  });

  it("says nothing when the API is actually mounted", async () => {
    const wrapper = render();
    await flushPromises();

    // A banner that fires when there is nothing wrong trains operators to
    // ignore it.
    expect(wrapper.text()).not.toContain("404");
  });

  it("points at .env rather than Global Settings for worker mode", async () => {
    // `SPORA_WORKER_RUNTIME_MODE` is bootOnly: rendered read-only on the
    // settings page and read before the database opens. Telling an operator
    // to change it there sends them somewhere they cannot act.
    workerRuntimeMode.value = "client";

    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain(".env");
    expect(wrapper.text()).not.toContain("under Global Settings");
  });
});
