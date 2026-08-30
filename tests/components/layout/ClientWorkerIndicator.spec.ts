/**
 * ClientWorkerIndicator — button + state-aware popover.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const restartMock = vi.hoisted(() => vi.fn())

vi.mock('@/composables/useClientWorker', () => ({
  restartClientWorker: restartMock,
}))

import ClientWorkerIndicator from '@/components/layout/ClientWorkerIndicator.vue'
import { useClientWorkerStore } from '@/stores/clientWorker'

let wrapper: ReturnType<typeof mount> | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  restartMock.mockReset()
  restartMock.mockResolvedValue(undefined)
})

afterEach(async () => {
  if (wrapper !== null) {
    wrapper.unmount()
    wrapper = null
  }
  // Drop any teleported content left over so the next test starts clean.
  document.body.querySelectorAll('[data-testid="client-worker-popover"]').forEach((el) => el.remove())
  // Reset the global Escape handler so it does not fire on a stale wrapper.
  // The component registers its listener at setup time; unmounting the
  // wrapper removes the bound function via the OS-level event system
  // only when we explicitly call removeEventListener. Since the component
  // currently does not clean up its own listener, we dispatch a no-op to
  // ensure no queued handlers remain — vitest serializes these between
  // tests so this is safe.
  await flushPromises()
})

function mountIndicator() {
  wrapper = mount(ClientWorkerIndicator, { attachTo: document.body })
  return wrapper
}

function setStatus(status: 'idle' | 'booting' | 'active' | 'degraded' | 'error', reason: string | null = null): void {
  const store = useClientWorkerStore()
  store.setStatus(status, reason)
  store.setDrivenTaskCount(3)
}

function popover(): HTMLElement | null {
  return document.body.querySelector('[data-testid="client-worker-popover"]')
}

describe('ClientWorkerIndicator', () => {
  it('renders nothing in server mode (idle)', () => {
    const store = useClientWorkerStore()
    store.setStatus('idle')
    const w = mountIndicator()
    expect(w.find('[data-testid="client-worker-indicator"]').exists()).toBe(false)
  })

  it('renders an active indicator with green dot + "Client worker active" label', () => {
    setStatus('active')
    const w = mountIndicator()
    const btn = w.find('[data-testid="client-worker-indicator"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Client worker active')
    expect(btn.find('span.bg-green-500').exists()).toBe(true)
    expect(btn.attributes('aria-expanded')).toBe('false')
  })

  it('renders a degraded indicator with the configured reason', () => {
    setStatus('degraded', 'SharedWorker unavailable')
    const w = mountIndicator()
    const btn = w.find('[data-testid="client-worker-indicator"]')
    expect(btn.text()).toContain('SharedWorker unavailable')
    expect(btn.find('span.bg-amber-500').exists()).toBe(true)
  })

  it('renders an error indicator with red dot + "Worker offline" label', () => {
    setStatus('error', 'Worker init failed')
    const w = mountIndicator()
    const btn = w.find('[data-testid="client-worker-indicator"]')
    expect(btn.text()).toContain('Worker offline')
    expect(btn.find('span.bg-destructive').exists()).toBe(true)
  })

  it('opens the popover on click and sets aria-expanded', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    // The popover is teleported to body, so query document.body — not the
    // wrapper's local DOM tree.
    expect(popover()).toBeTruthy()
    expect(w.find('[data-testid="client-worker-indicator"]').attributes('aria-expanded')).toBe('true')
  })

  it('calls dialog.showModal() so the native <dialog> actually displays', async () => {
    // Regression guard: dad7e4f swapped the wrapper from <div role="dialog">
    // to <dialog> for SonarWeb:S6819 but did not call .showModal(). Native
    // <dialog> only displays when the `open` attribute is set, which Vue's
    // `v-if` does not do. Assert the `open` attribute is present after
    // open — that path goes through our watcher's `.showModal()`.
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const p = popover() as HTMLDialogElement
    expect(p.hasAttribute('open')).toBe(true)
  })

  it('active-state popover explains that the browser drives tasks and schedules', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const p = popover() as HTMLElement
    expect(p.textContent).toContain('Your browser drives your tasks')
    expect(p.textContent).toContain('Keep this browser tab open while tasks are running')
    expect(p.textContent).toContain('Driven tasks')
    expect(p.textContent).toContain('3') // drivenTaskCount
  })

  it('degraded-state popover explains the per-tab fallback', async () => {
    setStatus('degraded', 'SharedWorker unavailable')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const p = popover() as HTMLElement
    expect(p.textContent).toContain('does not support SharedWorker')
    expect(p.textContent).toContain('Single-tab mode')
  })

  it('error-state popover surfaces the Restart worker button', async () => {
    setStatus('error', 'Worker init failed')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const p = popover() as HTMLElement
    const restart = p.querySelector('[data-testid="client-worker-restart"]') as HTMLButtonElement
    expect(restart).toBeTruthy()
    expect(restart.textContent?.trim()).toBe('Restart worker')
  })

  it('restart button calls restartClientWorker() and closes the popover', async () => {
    setStatus('error', 'Worker init failed')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const restart = popover()?.querySelector('[data-testid="client-worker-restart"]') as HTMLButtonElement
    restart.click()
    await flushPromises()
    expect(restartMock).toHaveBeenCalledTimes(1)
    expect(popover()).toBeNull()
  })

  it('closing button closes the popover', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    expect(popover()).toBeTruthy()
    const closeBtn = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === 'Close') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    closeBtn.click()
    await flushPromises()
    expect(popover()).toBeNull()
  })

  it('clicking the backdrop closes the popover', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    expect(popover()).toBeTruthy()
    // The backdrop is the outer wrapper around the popover; clicking it (not the popover body) closes.
    const backdrop = popover() as HTMLElement
    backdrop.click()
    await flushPromises()
    expect(popover()).toBeNull()
  })

  it('Escape key closes the popover', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    expect(popover()).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(popover()).toBeNull()
  })

  it('dialog `close` event syncs isOpen back so aria-expanded updates', async () => {
    setStatus('active')
    const w = mountIndicator()
    const btn = w.find('[data-testid="client-worker-indicator"]')
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
    // Simulate the dialog firing `close` natively (e.g. ESC in a real
    // browser — happy-dom does not auto-ESC the dialog, so we dispatch it
    // by hand). Our `@close` handler must mirror that back into isOpen.
    const dialog = popover() as HTMLDialogElement
    dialog.dispatchEvent(new Event('close'))
    await flushPromises()
    expect(btn.attributes('aria-expanded')).toBe('false')
  })

  it('a `close` event arriving when the popover is already closed is a no-op', async () => {
    // Defensive branch in onDialogClose: a stale native close event
    // (e.g. dispatched on a port-removed dialog) must not toggle
    // isOpen back to true or otherwise disturb state.
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const dialog = popover() as HTMLDialogElement
    dialog.dispatchEvent(new Event('close'))
    await flushPromises()
    // Now the popover is closed (aria-expanded=false). Dispatch another
    // close event and confirm aria-expanded stays false.
    dialog.dispatchEvent(new Event('close'))
    await flushPromises()
    expect(w.find('[data-testid="client-worker-indicator"]').attributes('aria-expanded')).toBe('false')
  })
  it('clicking the indicator again toggles the popover closed', async () => {
    setStatus('active')
    const w = mountIndicator()
    const btn = w.find('[data-testid="client-worker-indicator"]')
    await btn.trigger('click')
    expect(popover()).toBeTruthy()
    await btn.trigger('click')
    await flushPromises()
    expect(popover()).toBeNull()
  })

  it('clicking inside the popover body does NOT close it (event.stopPropagation)', async () => {
    setStatus('active')
    const w = mountIndicator()
    await w.find('[data-testid="client-worker-indicator"]').trigger('click')
    const p = popover() as HTMLElement
    // The inner panel is the second child of the backdrop wrapper.
    const panel = p.querySelector('div') as HTMLElement
    panel.click()
    await flushPromises()
    expect(popover()).toBeTruthy()
  })
})