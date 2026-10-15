/**
 * PluginInstallNotice — the composer warning attached to plugin installation.
 *
 * The claim it makes is specific and verifiable: the published Docker runtime
 * image contains no composer. That is the whole reason the warning exists, and
 * a warning that overstated or softened it would be worse than none — an
 * operator who reads "Docker is not recommended" as "Docker is unsupported"
 * would go looking for a problem that is not there.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import PluginInstallNotice from '@/components/settings/runtime/PluginInstallNotice.vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { GlobalSetting } from '@/types/globalSettings'

function setting(overrides: Partial<GlobalSetting> = {}): GlobalSetting {
  return {
    key: 'SPORA_KEY',
    group: 'framework',
    label: 'A setting',
    type: 'text',
    description: '',
    value: '',
    default: '',
    source: 'default',
    readonly: false,
    secret: false,
    undecryptable: false,
    options: [],
    ...overrides,
  } as GlobalSetting
}

function seed(installEnabled: boolean, composerBinary = 'composer'): void {
  const store = useGlobalSettingsStore()
  store.sections = [
    {
      key: 'plugins',
      label: 'Plugins',
      settings: [
        setting({
          key: 'SPORA_PLUGIN_INSTALL_ENABLED',
          label: 'Allow plugin installation',
          type: 'toggle',
          value: installEnabled,
        }),
        setting({
          key: 'SPORA_COMPOSER_BINARY',
          label: 'Composer binary',
          value: composerBinary,
        }),
      ],
    },
  ] as never
}

function mountNotice() {
  return mount(PluginInstallNotice, { global: { stubs: { Icon: true } } })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('PluginInstallNotice', () => {
  it('says nothing while installation is off', () => {
    seed(false)

    // Nothing to warn about: with the flag off, no install can be attempted.
    expect(mountNotice().text()).toBe('')
  })

  it('warns when installation is on and Composer is a bare name', () => {
    seed(true, 'composer')
    const text = mountNotice().text()

    // The failure is at the moment of installing, not at the moment of
    // switching the flag on, so the operator is told before they press the
    // button that starts it.
    expect(text).toContain('nothing here runs Composer')
    expect(text).toContain('will fail')
    expect(text).toContain('Docker')
  })

  it('says the image installs Composer while building and does not carry it', () => {
    seed(true, 'composer')

    // The precise claim, not "Docker is unsupported". Composer is present in
    // the build stage and absent from the runtime layer.
    expect(mountNotice().text()).toContain('installs Composer while building')
  })

  it('changes what it says when Composer binary points at a phar', () => {
    seed(true, '/opt/composer.phar')
    const text = mountNotice().text()

    // A phar runs through PHP_BINARY, so this configuration does work — and the
    // remaining hazard is the file existing inside the container at all.
    expect(text).toContain('points at a .phar')
    expect(text).toContain('this will work')
    expect(text).not.toContain('nothing here runs Composer')
  })

  it('treats a blank Composer binary the same as the default', () => {
    seed(true, '')
    const text = mountNotice().text()

    // The container falls back to `composer` on $PATH when the value is empty,
    // so the warning has to fire here too.
    expect(text).toContain('nothing here runs Composer')
  })
})