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
 */
import { ApiError } from '@/api/client'
import type { AgentEffort } from '@/types/effort'

/** The capability the endpoint answered with, per agent. */
export const capabilityByAgent = new Map<number, AgentEffort>()

/** The request that is on the wire for an agent, per agent. */
export const inflightByAgent = new Map<number, Promise<AgentEffort | undefined>>()

/**
 * The backend's code for a level the agent's driver does not declare.
 *
 * The refusal says the client's answer is out of date, not that the request
 * was malformed: the driver's level set moved on since the capability was
 * fetched.
 */
export const EFFORT_LEVEL_UNSUPPORTED = 'EFFORT_LEVEL_UNSUPPORTED'

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
