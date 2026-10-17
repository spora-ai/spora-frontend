<script setup lang="ts">
/**
 * PluginInstallNotice — the warning that belongs to "Allow plugin installation".
 *
 * It renders nothing unless the flag is on, and the flag is the only condition
 * under which it is true: turning installation off leaves nothing to warn about.
 *
 * The composer requirement is not a stylistic preference. `PluginManager` shells
 * out to a composer binary — a bare name resolved through `$PATH`, or a `.phar`
 * run through PHP_BINARY — and the published Docker runtime image contains
 * neither: composer is installed in the build stage only, and the runtime layer
 * copies `vendor/` across without it. So on that image the default
 * `SPORA_COMPOSER_BINARY=composer` cannot resolve, and the install fails at the
 * moment the operator presses the button rather than when they turn the flag on.
 *
 * Said once, here, rather than in the row: it applies to the section, not to one
 * setting, and repeating it per row is what made the source table unreadable.
 */
import { computed } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import AlertBanner from '@/components/ui/AlertBanner.vue'

const store = useGlobalSettingsStore()

const installEnabled = computed(
  () => store.sections.find((s) => s.key === 'plugins')
    ?.settings.find((x) => x.key === 'SPORA_PLUGIN_INSTALL_ENABLED')?.value === true,
)

const composerBinary = computed(
  () => store.sections.find((s) => s.key === 'plugins')
    ?.settings.find((x) => x.key === 'SPORA_COMPOSER_BINARY')?.value,
)

const isPhar = computed(() => String(composerBinary.value ?? '').trim().endsWith('.phar'))

const message = computed(() => {
  if (isPhar.value) {
    return 'Plugin installation is on and Composer binary points at a .phar, so this will work. The file has to exist inside the container — rebuild or mount it, since the published image ships no Composer.'
  }
  return 'Plugin installation is on, but nothing here runs Composer. The published Docker image installs Composer while building and does not carry it into the runtime layer, so installing a plugin will fail. On a shared host, install Composer globally or ship composer.phar and point Composer binary at it.'
})
</script>

<template>
  <AlertBanner
    v-if="installEnabled"
    type="warning"
    class="mb-4"
    :message="message"
  />
</template>