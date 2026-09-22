/**
 * useRecentGroups — localStorage-backed MRU list of group ids.
 *
 * Covers the move-to-front + dedupe + cap contract. Storage failure
 * modes (private browsing, corrupt JSON, storage cleared externally)
 * degrade gracefully: the in-memory ref still reflects subsequent
 * visits for the session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useRecentGroups } from '@/composables/useRecentGroups'

const STORAGE_KEY = 'spora.groups.recent.v1'
const MAX_RECENT = 10

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useRecentGroups', () => {
  it('starts empty on a fresh storage', () => {
    const { recentIds } = useRecentGroups()
    expect(recentIds.value).toEqual([])
  })

  it('reads a previously persisted list on init', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([3, 1, 2]))
    const { recentIds } = useRecentGroups()
    expect(recentIds.value).toEqual([3, 1, 2])
  })

  it('drops non-array / non-numeric entries from corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }))
    const { recentIds } = useRecentGroups()
    expect(recentIds.value).toEqual([])
  })

  it('treats malformed JSON as an empty list', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const { recentIds } = useRecentGroups()
    expect(recentIds.value).toEqual([])
  })

  it('records a new visit at the head of the list', () => {
    const { recordVisit, recentIds } = useRecentGroups()
    recordVisit(7)
    expect(recentIds.value).toEqual([7])
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[7]')
  })

  it('moves an existing id to the head on a repeat visit', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]))
    const { recordVisit, recentIds } = useRecentGroups()
    recordVisit(2)
    expect(recentIds.value).toEqual([2, 1, 3])
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[2,1,3]')
  })

  it('caps the list at MAX_RECENT entries', () => {
    const { recordVisit, recentIds } = useRecentGroups()
    for (let i = 0; i < MAX_RECENT + 3; i += 1) {
      recordVisit(i)
    }
    expect(recentIds.value).toHaveLength(MAX_RECENT)
    // Most-recent first; the oldest three were evicted.
    expect(recentIds.value[0]).toBe(MAX_RECENT + 2)
    expect(recentIds.value[MAX_RECENT - 1]).toBe(3)
  })

  it('clear empties both the ref and storage', () => {
    const { recordVisit, clear, recentIds } = useRecentGroups()
    recordVisit(1)
    recordVisit(2)
    clear()
    expect(recentIds.value).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]')
  })

  it('survives a storage write failure with the in-memory ref intact', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const { recordVisit, recentIds } = useRecentGroups()
    recordVisit(42)
    expect(recentIds.value).toEqual([42])
    expect(setItemSpy).toHaveBeenCalled()
    setItemSpy.mockRestore()
  })
})
