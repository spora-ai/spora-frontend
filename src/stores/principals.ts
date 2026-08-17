import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchMyPrincipals } from '../api/principals'
import type { Principal } from '../types/principal'

export const usePrincipalsStore = defineStore('principals', () => {
    const principals = ref<Principal[]>([])
    const currentPrincipalId = ref<number | null>(null)
    async function load() { principals.value = await fetchMyPrincipals() }
    function setCurrent(id: number | null) { currentPrincipalId.value = id }
    return { principals, currentPrincipalId, load, setCurrent }
})