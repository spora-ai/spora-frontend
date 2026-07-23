import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadComposerDrafts, saveComposerDrafts } from '@/composables/useComposerDrafts'
import type { MediaAsset } from '@/types/media'

const sessionStorageStore: Record<string, string> = {}

function asset(id: string, partial: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    filename: `${id}.txt`,
    media_type: 'document',
    mime_type: 'text/plain',
    byte_size: 12,
    asset_url: `https://example.test/${id}`,
    has_markdown: false,
    ...partial,
  }
}

beforeEach(() => {
  for (const k in sessionStorageStore) delete sessionStorageStore[k]
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (k: string) => sessionStorageStore[k] ?? null,
      setItem: (k: string, v: string) => { sessionStorageStore[k] = v },
      removeItem: (k: string) => { delete sessionStorageStore[k] },
    },
    configurable: true,
  })
})

describe('useComposerDrafts', () => {
  describe('loadComposerDrafts', () => {
    it('returns empty map when storage is empty', () => {
      expect(loadComposerDrafts()).toEqual({})
    })

    it('parses a stored JSON object with attachments', () => {
      const stored = JSON.stringify({
        1: {
          promptText: 'hello',
          attachments: [asset('media-1'), asset('media-2')],
        },
      })
      sessionStorageStore['spora:composer-drafts'] = stored

      expect(loadComposerDrafts()).toEqual({
        1: {
          promptText: 'hello',
          attachments: [asset('media-1'), asset('media-2')],
        },
      })
    })

    it('normalizes a legacy prompt-only draft to include empty attachments', () => {
      // Pre-attachments drafts stored as `{ promptText }` only — we must
      // not drop them, but they need an attachments array for the new shape.
      sessionStorageStore['spora:composer-drafts'] = JSON.stringify({ 3: { promptText: 'legacy' } })

      expect(loadComposerDrafts()).toEqual({
        3: { promptText: 'legacy', attachments: [] },
      })
    })

    it('drops attachment entries that lack an id', () => {
      sessionStorageStore['spora:composer-drafts'] = JSON.stringify({
        9: { promptText: 'mix', attachments: [asset('ok'), { filename: 'no-id' }] },
      })

      const loaded = loadComposerDrafts()
      expect(loaded[9]?.promptText).toBe('mix')
      expect(loaded[9]?.attachments).toHaveLength(1)
      expect(loaded[9]?.attachments[0]?.id).toBe('ok')
    })

    it('skips non-integer agent keys without throwing', () => {
      sessionStorageStore['spora:composer-drafts'] = JSON.stringify({
        notanumber: { promptText: 'skip me' },
        4: { promptText: 'keep', attachments: [] },
      })

      const loaded = loadComposerDrafts()
      expect(Object.keys(loaded)).toEqual(['4'])
      expect(loaded[4]?.promptText).toBe('keep')
    })

    it('returns empty map when stored value is not a JSON object', () => {
      sessionStorageStore['spora:composer-drafts'] = JSON.stringify(['array', 'not', 'object'])
      expect(loadComposerDrafts()).toEqual({})
    })

    it('returns empty map on corrupt JSON', () => {
      sessionStorageStore['spora:composer-drafts'] = '{not valid json'
      expect(loadComposerDrafts()).toEqual({})
    })

    it('returns empty map when sessionStorage throws (private mode)', () => {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: { getItem: () => { throw new Error('SecurityError') } },
        configurable: true,
      })
      expect(loadComposerDrafts()).toEqual({})
    })
  })

  describe('saveComposerDrafts', () => {
    it('persists the map as JSON including attachments', () => {
      saveComposerDrafts({
        7: { promptText: 'draft', attachments: [asset('m1')] },
      })
      expect(sessionStorageStore['spora:composer-drafts']).toBe(
        JSON.stringify({ 7: { promptText: 'draft', attachments: [asset('m1')] } }),
      )
    })

    it('silently no-ops when setItem throws', () => {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: { setItem: () => { throw new Error('QuotaExceeded') } },
        configurable: true,
      })
      // Should not throw.
      expect(() => saveComposerDrafts({ 1: { promptText: 'x', attachments: [] } })).not.toThrow()
    })
  })

  describe('round-trip', () => {
    it('load → save preserves attachments', () => {
      const original = {
        1: { promptText: 'persist me', attachments: [asset('a'), asset('b')] },
        2: { promptText: '', attachments: [] },
      }
      saveComposerDrafts(original)
      // Re-read from storage via the same loader the store uses on init.
      const reloaded = loadComposerDrafts()
      expect(reloaded).toEqual(original)
    })
  })
})
