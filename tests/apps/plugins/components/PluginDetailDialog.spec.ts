/**
 * PluginDetailDialog — full metadata modal for a single plugin.
 *
 * The dialog uses <Teleport to="body">, so the rendered DOM lives in
 * document.body rather than inside the wrapper tree. Tests query the body
 * via a [data-testid] selector to keep assertions focused.
 *
 * The companion-plugin rows now read `usePluginsStore()`, so the suite
 * primes a Pinia instance and stubs `usePluginsStore` with a tiny in-place
 * fixture controller (mirroring `PluginsPage.spec.ts`).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PluginDetailDialog from '@/apps/plugins/components/PluginDetailDialog.vue'
import type { PluginResource } from '@/apps/plugins/types/plugin'

const installed: Ref<PluginResource[]> = ref([])
vi.mock('@/apps/plugins/stores/plugins', () => ({
  usePluginsStore: () => ({
    get plugins() { return installed.value },
  }),
}))

const basePlugin: PluginResource = {
  slug: 'minimax',
  package: 'spora-ai/spora-plugin-minimax',
  name: 'MiniMax',
  description: 'Multimodal content generation.',
  icon: 'puzzle',
  version: 2,
  path: '/opt/spora-plugins/minimax',
  bundledTools: [
    { name: 'image', description: 'Generate an image from a prompt.' },
    { name: 'speech', description: 'Synthesize speech from text.' },
  ],
  migrations: {
    declared: 2,
    applied: 2,
    filesOnDisk: 2,
    pending: 0,
    lastAppliedAt: '2026-06-09 10:15:32',
    status: 'up_to_date',
  },
}

function dialogInBody(): HTMLElement | null {
  return document.body.querySelector('[data-testid="plugin-detail-dialog"]')
}

beforeEach(() => {
  setActivePinia(createPinia())
  installed.value = []
  // Each test mounts fresh; make sure no leftover teleported content lingers.
  document.body.querySelectorAll('[data-testid="plugin-detail-dialog"]').forEach(el => el.remove())
})

afterEach(() => {
  document.body.querySelectorAll('[data-testid="plugin-detail-dialog"]').forEach(el => el.remove())
})

describe('PluginDetailDialog', () => {
  it('renders nothing when open is false', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: false, plugin: basePlugin },
    })
    expect(dialogInBody()).toBeNull()
  })

  it('renders nothing when plugin is null', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: null },
    })
    expect(dialogInBody()).toBeNull()
  })

  it('renders the plugin header and description when open and plugin are set', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('MiniMax')
    expect(text).toContain('minimax')
    expect(text).toContain('Multimodal content generation.')
  })

  it('lists bundled tools with the slug-prefixed qualified name', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('minimax:image')
    expect(text).toContain('minimax:speech')
    expect(text).toContain('Generate an image from a prompt.')
  })

  it('shows the migration status badge and breakdown', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Up to date')
    expect(text).toContain('Declared version')
    expect(text).toContain('Files on disk')
    expect(text).toContain('Applied')
    expect(text).toContain('Pending')
    expect(text).toContain('2026-06-09 10:15:32')
  })

  it('shows "never" for lastAppliedAt when null', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        plugin: { ...basePlugin, migrations: { ...basePlugin.migrations, lastAppliedAt: null } },
      },
    })
    expect(document.body.textContent ?? '').toContain('never')
  })

  it('shows the plugin path', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    expect(document.body.textContent ?? '').toContain('/opt/spora-plugins/minimax')
  })

  it('hides the plugin path section when path is null', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        plugin: { ...basePlugin, path: null },
      },
    })
    expect(document.body.textContent ?? '').not.toContain('Plugin path')
  })

  it('emits close when the X button is clicked', async () => {
    const wrapper = mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    const closeButton = document.body.querySelector('button[aria-label="Close dialog"]') as HTMLElement | null
    expect(closeButton).not.toBeNull()
    closeButton!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when the backdrop is clicked', async () => {
    const wrapper = mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: basePlugin },
    })
    const backdrop = document.body.querySelector('[data-testid="plugin-detail-dialog"]')?.parentElement as HTMLElement | null
    expect(backdrop).not.toBeNull()
    backdrop!.click()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('omits the bundled tools section when no tools are declared', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: { ...basePlugin, bundledTools: [] } },
    })
    expect(document.body.textContent ?? '').not.toContain('Bundled tools')
  })

  it('omits the description when plugin has none', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: { open: true, plugin: { ...basePlugin, description: '' } },
    })
    const text = document.body.textContent ?? ''
    // The description <p> is only rendered when description is truthy.
    expect(text).toContain('MiniMax')
    expect(text).not.toContain('Multimodal content generation.')
  })

  it('forwards the InstallPluginModal @installed event to its own "installed" emit', async () => {
    // Stub the child InstallPluginModal so the dialog's emit-propagation
    // is asserted without needing a real Pinia / API stack. The stub
    // exposes a button that fires `installed` like a successful submit.
    const wrapper = mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        showInstallButton: true,
        plugin: { ...basePlugin, suggests: { 'spora-ai/spora-plugin-tavily': 'Web search.' } },
      },
      global: {
        stubs: {
          InstallPluginModal: {
            name: 'InstallPluginModal',
            props: ['open', 'package'],
            emits: ['close', 'installed'],
            template:
              '<button v-if="open" class="install-modal-stub" @click="$emit(\'installed\', { package: package })" />',
          },
        },
      },
    })

    // Open the companion-install path so the child modal mounts.
    const suggestButton = document.body.querySelector('[data-testid="plugin-suggest-install-spora-ai/spora-plugin-tavily"]') as HTMLButtonElement | null
    expect(suggestButton).not.toBeNull()
    suggestButton!.click()
    await flushPromises()

    const modal = document.body.querySelector('.install-modal-stub') as HTMLButtonElement | null
    expect(modal).not.toBeNull()
    modal!.click()

    expect(wrapper.emitted('installed')).toBeTruthy()
    expect(wrapper.emitted('installed')![0]).toEqual([{ package: 'spora-ai/spora-plugin-tavily' }])
  })

  it('hides the install button on a companion plugin row when showInstallButton is false', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        showInstallButton: false,
        plugin: { ...basePlugin, suggests: { 'spora-ai/spora-plugin-tavily': 'Web search.' } },
      },
    })

    // Row stays visible (name + description) so the operator still sees what the
    // companion plugin does, but no Install affordance is offered.
    expect(document.body.textContent ?? '').toContain('spora-ai/spora-plugin-tavily')
    expect(document.body.textContent ?? '').toContain('Web search.')
    expect(
      document.body.querySelector('[data-testid="plugin-suggest-install-spora-ai/spora-plugin-tavily"]'),
    ).toBeNull()
  })

  it('renders an Installed pill on a companion plugin row whose package matches an installed plugin', () => {
    installed.value = [
      { ...basePlugin, slug: 'tavily', package: 'spora-ai/spora-plugin-tavily' },
    ]

    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        showInstallButton: true,
        plugin: { ...basePlugin, suggests: { 'spora-ai/spora-plugin-tavily': 'Web search.' } },
      },
    })

    const pill = document.body.querySelector('[data-testid="plugin-suggest-installed-spora-ai/spora-plugin-tavily"]')
    expect(pill).not.toBeNull()
    expect(pill?.textContent ?? '').toMatch(/installed/i)
    expect(
      document.body.querySelector('[data-testid="plugin-suggest-install-spora-ai/spora-plugin-tavily"]'),
    ).toBeNull()
  })

  it('still renders the install button on an uninstalled companion plugin row when showInstallButton is true', () => {
    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        showInstallButton: true,
        plugin: { ...basePlugin, suggests: { 'spora-ai/spora-plugin-tavily': 'Web search.' } },
      },
    })

    expect(
      document.body.querySelector('[data-testid="plugin-suggest-install-spora-ai/spora-plugin-tavily"]'),
    ).not.toBeNull()
    expect(
      document.body.querySelector('[data-testid="plugin-suggest-installed-spora-ai/spora-plugin-tavily"]'),
    ).toBeNull()
  })

  it('matches a hand-rolled installed plugin whose slug equals the suggest key', () => {
    // Hand-rolled plugin — no composer sidecar (`package: null`). The slug
    // 'tavily' lines up with a sibling's `suggest` key written as 'tavily'.
    installed.value = [{ ...basePlugin, slug: 'tavily', package: null }]

    mount(PluginDetailDialog, {
      attachTo: document.body,
      props: {
        open: true,
        showInstallButton: true,
        plugin: { ...basePlugin, suggests: { tavily: 'Web search.' } },
      },
    })

    expect(
      document.body.querySelector('[data-testid="plugin-suggest-installed-tavily"]'),
    ).not.toBeNull()
  })
})
