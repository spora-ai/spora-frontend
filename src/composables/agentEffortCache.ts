/**
 * agentEffortCache — the session cache of the agents' reasoning-effort
 * capability.
 *
 * `GET /agents/{id}/effort` answers with the effective driver's level set
 * and the effective config's default. The answer only changes when the
 * agent's LLM configuration changes, so it is cached for the session.
 *
 * The cache lives in its own module because the composable that fills it
 * cannot be the one that drops it: `useAgentEffort` imports the agent
 * store, and the agent store is where the LLM configuration changes.
 *
 * The maps are private and the module hands out the reads and the writes
 * instead: a cached capability cannot be filled or dropped from the
 * outside without the epoch bookkeeping that goes with it.
 */
import { ApiError } from '@/api/client'
import type { AgentEffort } from '@/types/effort'

/** The capability the endpoint answered with, per agent. */
const capabilityByAgent = new Map<number, AgentEffort>()

/** The request that is on the wire for an agent, per agent. */
const inflightByAgent = new Map<number, Promise<AgentEffort | undefined>>()

/**
 * The backend's code for a level the agent's driver does not declare.
 *
 * The refusal says the client's answer is out of date, not that the request
 * was malformed: the driver's level set moved on since the capability was
 * fetched.
 */
const EFFORT_LEVEL_UNSUPPORTED = 'EFFORT_LEVEL_UNSUPPORTED'

/**
 * Whether the refusal says the cached capability is out of date.
 *
 * `INVALID_EFFORT` — the body field is malformed — is the caller's to fix;
 * nothing about the capability is stale, so it must not drop the cache.
 */
export function isEffortLevelUnsupported(error: unknown): boolean {
  return error instanceof ApiError && error.code === EFFORT_LEVEL_UNSUPPORTED
}

/**
 * Per-agent counter, bumped whenever that agent's cached capability is
 * dropped.
 *
 * A request that was already on the wire when the cache was dropped must
 * not write its answer back: it describes the configuration as it was
 * before the change, and after a sign-out it describes the previous user's
 * agent.
 */
const epochs = new Map<number, number>()

/** The epoch the agent's cached capability belongs to. */
export function epochFor(agentId: number): number {
  return epochs.get(agentId) ?? 0
}

/** The capability cached for an agent, if there is one. */
export function cachedCapability(agentId: number): AgentEffort | undefined {
  return capabilityByAgent.get(agentId)
}

/** Cache the capability the endpoint answered with for an agent. */
export function cacheCapability(agentId: number, capability: AgentEffort): void {
  capabilityByAgent.set(agentId, capability)
}

/**
 * The request that is on the wire for an agent, if there is one.
 *
 * Two surfaces on the same agent share one request: the second one waits
 * for the answer instead of asking the backend a second time.
 */
export function inflightRequest(agentId: number): Promise<AgentEffort | undefined> | undefined {
  return inflightByAgent.get(agentId)
}

/** Register the request that is on the wire for an agent. */
export function registerInflight(agentId: number, request: Promise<AgentEffort | undefined>): void {
  inflightByAgent.set(agentId, request)
}

/**
 * Unregister the request, if it is still the registered one.
 *
 * A request that was dropped from the cache must not unregister the one
 * that replaced it.
 */
export function releaseInflight(agentId: number, request: Promise<AgentEffort | undefined>): void {
  if (inflightByAgent.get(agentId) === request) {
    inflightByAgent.delete(agentId)
  }
}

/**
 * Drop the cached capability.
 *
 * Without an agent id the whole session cache goes — the sign-out path,
 * where one user's capability must not answer another user's request. With
 * an id only that agent's entry goes: its LLM configuration changed, so
 * its level set and default are no longer the truth.
 */
export function clearAgentEffortCache(agentId?: number): void {
  if (agentId === undefined) {
    for (const id of new Set([...capabilityByAgent.keys(), ...inflightByAgent.keys()])) {
      epochs.set(id, epochFor(id) + 1)
    }
    capabilityByAgent.clear()
    inflightByAgent.clear()
    return
  }
  capabilityByAgent.delete(agentId)
  inflightByAgent.delete(agentId)
  epochs.set(agentId, epochFor(agentId) + 1)
}
