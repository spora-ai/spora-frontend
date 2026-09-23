/**
 * /api/v1/me/picture client — exercises the multipart upload + delete
 * envelope unwrap so the per-file `FormData` shape and the
 * `data.profile_picture` destructuring stay under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { postForm, deleteFn } = vi.hoisted(() => ({
  postForm: vi.fn(),
  deleteFn: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    postForm,
    delete: deleteFn,
  },
}))

import { deleteMyProfilePicture, uploadMyProfilePicture } from '@/api/me'

describe('/api/v1/me/picture client', () => {
  beforeEach(() => {
    postForm.mockReset()
    deleteFn.mockReset()
  })

  it('uploadMyProfilePicture posts multipart and unwraps profile_picture', async () => {
    const picture = {
      kind: 'image' as const,
      image_url: '/api/v1/users/1/picture',
      image_updated_at: '2026-09-23T10:00:00+00:00',
    }
    postForm.mockResolvedValueOnce({ profile_picture: picture })

    const file = new File(['fake'], 'avatar.png', { type: 'image/png' })
    const result = await uploadMyProfilePicture(file)

    expect(postForm).toHaveBeenCalledWith(
      '/me/picture/image',
      expect.any(FormData),
    )
    const formArg = postForm.mock.calls[0]?.[1] as FormData
    expect(formArg.get('file')).toBe(file)
    expect(result).toEqual(picture)
  })

  it('deleteMyProfilePicture issues DELETE /me/picture/image', async () => {
    deleteFn.mockResolvedValueOnce(undefined)

    await deleteMyProfilePicture()

    expect(deleteFn).toHaveBeenCalledWith('/me/picture/image')
  })
})
