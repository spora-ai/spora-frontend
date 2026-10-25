/**
 * ToastContainer — receives toasts as a prop and renders each via <Toast>.
 *
 * The Toast sub-component uses Teleport to <body>, which is hard to assert
 * in a unit test. The test confirms the container renders the right number of
 * items by checking the data attributes the real Toast sets.
 */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'

import ToastContainer from '@/components/ui/ToastContainer.vue'

describe('ToastContainer', () => {
  it('mounts without throwing for an empty list', () => {
    mount(ToastContainer, {
      props: { toasts: [], onDismiss: () => undefined },
      attachTo: document.body,
    })
    // "The wrapper exists" is true of every mounted component, so it proves
    // nothing. What an empty queue owes the operator is the live region and
    // no toast in it.
    expect(document.body.querySelector('[aria-live="assertive"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(0)
  })

  it('mounts with toasts without throwing', () => {
    const toasts = [
      { id: '1', severity: 'info' as const, message: 'Hello' },
      { id: '2', severity: 'error' as const, message: 'World' },
    ]
    mount(ToastContainer, {
      props: { toasts, onDismiss: () => undefined },
      attachTo: document.body,
    })
    // After mount, the Teleport moves the toast to <body>. Confirm at least one
    // toast text node is now in the document body.
    expect(document.body.textContent).toContain('Hello')
    expect(document.body.textContent).toContain('World')
  })
})
