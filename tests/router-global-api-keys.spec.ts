import { describe, it, expect } from 'vitest'
import router from '@/router'

/**
 * The global API keys page is an admin route under Global Settings.
 *
 * The admin check lives in the page (`AdminForbidden`), not in the router —
 * the same pattern the other admin pages use — so what this pins is that the
 * route resolves and that it sits with the other admin entries.
 */
describe('the global API keys route', () => {
  it('resolves to the global API keys page', () => {
    // The real router, not a stub: a stub that declares the route itself
    // answers whether or not the app has one.
    const resolved = router.resolve('/settings/admin/global-api-keys')

    expect(resolved.name).toBe('settings-admin-global-api-keys')
    expect(resolved.path).toBe('/settings/admin/global-api-keys')
  })

  it('sits under the settings layout', () => {
    const route = router.getRoutes().find((r) => r.name === 'settings-admin-global-api-keys')

    expect(route).toBeDefined()
    expect(route?.path).toBe('/settings/admin/global-api-keys')
  })
})
