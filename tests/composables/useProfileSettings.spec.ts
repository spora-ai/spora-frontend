/**
 * useProfileSettings — pure helpers for ProfileSettingsPage.
 */
import { describe, it, expect } from 'vitest'
import { emptyProfile } from '@/composables/useProfileSettings'

describe('useProfileSettings helpers', () => {
  describe('emptyProfile', () => {
    it('returns a profile with all fields null', () => {
      expect(emptyProfile()).toEqual({
        name: null,
        date_of_birth: null,
        about_me: null,
        height_cm: null,
        weight_kg: null,
      })
    })
  })
})
