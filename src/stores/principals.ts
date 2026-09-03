/**
 * Pinia store: caller's principals list + currentPrincipalId tracking for the dashboard / dialog / sidebar.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchMyPrincipals } from '../api/principals'
import type { Principal } from '../types/principal'

export const usePrincipalsStore = defineStore('principals', () => {
    const principals = ref<Principal[]>([])
    const currentPrincipalId = ref<number | null>(null)
    async function load() { principals.value = await fetchMyPrincipals() }
    function setCurrent(id: number | null) { currentPrincipalId.value = id }

    // Used by the Mercure SSE subscription in useRealtime — every principal
    // a user can act as has its own `principal/{id}/tasks` topic. Group
    // members receive events for their group-owned agents; the same user
    // may be in many groups and must subscribe to every principal topic.
    const visiblePrincipalIds = computed<number[]>(() => principals.value.map((p) => p.id))

    return { principals, currentPrincipalId, load, setCurrent, visiblePrincipalIds }
})