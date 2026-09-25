import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

import { api } from '@/api/client'
import { useBundledSkills } from '@/composables/useBundledSkills'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.resetAllMocks()
})

function lastPutBody(): { settings: Record<string, string> } {
  const calls = mockApi.put.mock.calls
  const last = calls[calls.length - 1]
  if (!last) throw new Error('PUT was never called')
  const body = last[1] as { settings: Record<string, string> }
  return body
}

describe('useBundledSkills', () => {
  describe('readEffectiveSkills', () => {
    it('parses a JSON-encoded allowed_skills array', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["git","pdf"]' } })
      const { readEffectiveSkills } = useBundledSkills(ref(1))
      const result = await readEffectiveSkills()
      expect(result).toEqual(['git', 'pdf'])
      expect(mockApi.get).toHaveBeenCalledWith('/agents/1/tools/skill/override')
    })

    it('returns an empty array when the setting is absent or empty', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: {} })
      const { readEffectiveSkills } = useBundledSkills(ref(1))
      expect(await readEffectiveSkills()).toEqual([])
    })

    it('returns an empty array on a malformed JSON payload', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: 'not-json' } })
      const { readEffectiveSkills } = useBundledSkills(ref(1))
      expect(await readEffectiveSkills()).toEqual([])
    })
  })

  describe('addSkillsToAllowlist', () => {
    it('preserves existing slugs and appends new ones (dedupes on overlap)', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a","b"]' } })
      mockApi.put.mockResolvedValueOnce({ settings: {} })
      const { addSkillsToAllowlist } = useBundledSkills(ref(1))
      await addSkillsToAllowlist(['b', 'c'])
      const body = lastPutBody()
      expect(JSON.parse(body.settings['allowed_skills'])).toEqual(['a', 'b', 'c'])
      expect(mockApi.put).toHaveBeenCalledWith('/agents/1/tools/skill/override', body)
    })

    it('dedupes on add when the existing list itself has duplicates', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a","a","b"]' } })
      mockApi.put.mockResolvedValueOnce({ settings: {} })
      const { addSkillsToAllowlist } = useBundledSkills(ref(1))
      await addSkillsToAllowlist(['b', 'c'])
      expect(JSON.parse(lastPutBody().settings['allowed_skills'])).toEqual(['a', 'b', 'c'])
    })

    it('surfaces the error and sets the error ref when the GET fails', async () => {
      const { ApiError } = await import('@/api/client')
      mockApi.get.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'missing', 404))
      const { addSkillsToAllowlist, error } = useBundledSkills(ref(1))
      await expect(addSkillsToAllowlist(['x'])).rejects.toThrow('missing')
      expect(error.value).toBe('missing')
    })
  })

  describe('removeSkillsFromAllowlist', () => {
    it('subtracts slugs while preserving the rest of the list', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a","b","c"]' } })
      mockApi.put.mockResolvedValueOnce({ settings: {} })
      const { removeSkillsFromAllowlist } = useBundledSkills(ref(1))
      await removeSkillsFromAllowlist(['b'])
      expect(JSON.parse(lastPutBody().settings['allowed_skills'])).toEqual(['a', 'c'])
    })

    it('is a no-op when the requested slugs are not in the allowlist', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a"]' } })
      mockApi.put.mockResolvedValueOnce({ settings: {} })
      const { removeSkillsFromAllowlist } = useBundledSkills(ref(1))
      await removeSkillsFromAllowlist(['zzz'])
      expect(JSON.parse(lastPutBody().settings['allowed_skills'])).toEqual(['a'])
    })
  })

  describe('loading flag', () => {
    it('flips true during a successful add then back to false', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '["a"]' } })
      let resolvePut!: (v: unknown) => void
      mockApi.put.mockReturnValueOnce(new Promise((res) => { resolvePut = res }))
      const { addSkillsToAllowlist, loading } = useBundledSkills(ref(1))
      const pending = addSkillsToAllowlist(['b'])
      expect(loading.value).toBe(true)
      resolvePut({ settings: {} })
      await pending
      expect(loading.value).toBe(false)
    })

    it('flips true during a failed remove then back to false', async () => {
      const { ApiError } = await import('@/api/client')
      mockApi.get.mockRejectedValueOnce(new ApiError('boom', 'boom', 500))
      const { removeSkillsFromAllowlist, loading } = useBundledSkills(ref(1))
      await expect(removeSkillsFromAllowlist(['x'])).rejects.toThrow('boom')
      expect(loading.value).toBe(false)
    })
  })

  describe('custom skillToolName', () => {
    it('targets the given tool name in the URL', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '[]' } })
      const { readEffectiveSkills } = useBundledSkills(ref(7), 'custom_skill')
      await readEffectiveSkills()
      expect(mockApi.get).toHaveBeenCalledWith('/agents/7/tools/custom_skill/override')
    })

    it('URL-encodes a tool name with special characters', async () => {
      mockApi.get.mockResolvedValueOnce({ settings: { allowed_skills: '[]' } })
      const { readEffectiveSkills } = useBundledSkills(ref(1), 'skill/v2')
      await readEffectiveSkills()
      expect(mockApi.get).toHaveBeenCalledWith('/agents/1/tools/skill%2Fv2/override')
    })
  })

  describe('reactive agentId', () => {
    it('re-reads the agentId on every request', async () => {
      const agentId = ref(1)
      mockApi.get.mockResolvedValue({ settings: { allowed_skills: '[]' } })
      const { readEffectiveSkills } = useBundledSkills(agentId)
      await readEffectiveSkills()
      agentId.value = 42
      await readEffectiveSkills()
      expect(mockApi.get.mock.calls[0]?.[0]).toBe('/agents/1/tools/skill/override')
      expect(mockApi.get.mock.calls[1]?.[0]).toBe('/agents/42/tools/skill/override')
    })
  })
})
