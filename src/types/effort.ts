/**
 * Reasoning effort — the vocabulary the chat shares with the backend.
 *
 * The level set belongs to the LLM configuration, not to the driver class:
 * an operator names the levels their endpoint takes, so a level is whatever
 * name that set contains. The canonical scale is the *label map* in
 * `@/utils/effortLevels`, not the vocabulary.
 */

/**
 * What the chat sends with a message.
 *
 * The empty string is the "model default" choice and is not the same as
 * sending nothing: an absent `effort` key falls back to the config's
 * default, an empty string asks for the model default, and a level asks
 * for that level.
 *
 * A level is any name the driver's level set offers — the canonical scale
 * is a label map, not a constraint.
 */
export type EffortSelection = string

/**
 * One level the driver offers, with the label the driver chose for it.
 *
 * The endpoint is the authority on which levels exist, so a level it names
 * is offered as it stands — whether or not the canonical scale names it
 * yet.
 */
export interface EffortOption {
  value: string
  label: string
}

/**
 * `GET /agents/{id}/effort` — the agent's effort capability.
 *
 * `levels` is the effective driver's level set, `default` the level the
 * agent runs with when nobody names one (`null` = the model default).
 */
export interface AgentEffort {
  supported: boolean
  levels: EffortOption[]
  default: string | null
}
