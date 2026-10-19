import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import router from '@/router'

/**
 * `/agents/:id/api-keys` used to be its own page and is now a section within
 * Settings. The route is kept purely so links shared before the move land
 * somewhere useful instead of 404ing — which means the redirect itself is
 * the behaviour, and it is what these assert.
 */

describe('the retired API keys route', () => {
  it('redirects to the settings section, keeping the agent', async () => {
    // A bare router, so the assertion is about the redirect and not about
    // whatever guards the real router's routes.
    const stub = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/agents/:id/settings', name: 'agent-settings', component: { template: '<div />' } },
        ...(router.getRoutes().filter((route) => route.name === 'agent-api-keys') as RouteRecordRaw[]),
      ],
    })

    await stub.push('/agents/7/api-keys')
    await stub.isReady()

    expect(stub.currentRoute.value.name).toBe('agent-settings')
    expect(stub.currentRoute.value.params.id).toBe('7')
    expect(stub.currentRoute.value.hash).toBe('#api-keys')
  })

  it('is still registered, so the old URL is not a dead link', () => {
    // If the route were simply removed this would fail — and every bookmark
    // would 404 rather than land on the section.
    const match = router.getRoutes().find((route) => route.name === 'agent-api-keys')

    expect(match).toBeDefined()
    expect(match?.redirect).toBeDefined()
  })

  it('requires auth, like every other agent route', () => {
    const match = router.getRoutes().find((route) => route.name === 'agent-api-keys')

    // A redirect that bypasses the guard would let a signed-out visitor
    // resolve the URL and reach the settings route.
    expect(match?.meta?.requiresAuth).toBe(true)
  })

  it('leaves the settings route itself alone', () => {
    expect(router.resolve('/agents/7/settings').name).toBe('agent-settings')
  })
})
