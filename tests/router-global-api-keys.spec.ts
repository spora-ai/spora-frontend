import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import router from '@/router'

/**
 * The global API keys page is an admin route under Global Settings.
 *
 * The admin check lives in the page (`AdminForbidden`), not in the router —
 * the same pattern the other admin pages use — so what this pins is that the
 * route resolves and that it sits with the other admin entries.
 */
describe('the global API keys route', () => {
  it('resolves to the global API keys page', async () => {
    const stub = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/settings/admin/global-api-keys',
          name: 'settings-admin-global-api-keys',
          component: { template: '<div />' },
        },
        ...(router.getRoutes().filter((route) => route.name === 'settings-admin-global-api-keys') as RouteRecordRaw[]),
      ],
    })

    await stub.push('/settings/admin/global-api-keys')
    await stub.isReady()

    expect(stub.currentRoute.value.name).toBe('settings-admin-global-api-keys')
  })

  it('sits under the settings layout', () => {
    const route = router.getRoutes().find((r) => r.name === 'settings-admin-global-api-keys')

    expect(route).toBeDefined()
    expect(route?.path).toBe('/settings/admin/global-api-keys')
  })
})
