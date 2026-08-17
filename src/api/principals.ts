import { api } from './client'
import type { Principal } from '@/types/principal'

export function fetchMyPrincipals(): Promise<Principal[]> {
  return api.get<{ principals: Principal[] }>('/principals/me').then((r) => r.principals)
}