import { api } from './client'
import type { ProfilePicture } from '@/types/profilePicture'

export async function uploadMyProfilePicture(file: File): Promise<ProfilePicture> {
  const form = new FormData()
  form.append('file', file)
  const r = await api.postForm<{ profile_picture: ProfilePicture }>('/me/picture/image', form)
  return r.profile_picture
}

export async function deleteMyProfilePicture(): Promise<void> {
  await api.delete<void>('/me/picture/image')
}
