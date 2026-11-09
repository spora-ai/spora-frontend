/**
 * Reasoning effort — the vocabulary the chat shares with the backend.
 *
 * The canonical scale lives in the backend (`Spora\Drivers\EffortLevel`); the
 * frontend mirrors it so a level the picker offers is spelled the way the
 * driver expects it.
 */

/** The canonical scale, ascending. */
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * What the chat sends with a message.
 *
 * The empty string is the "model default" choice and is not the same as
 * sending nothing: an absent `effort` key falls back to the config's
 * default, an empty string asks for the model default, and a level asks
 * for that level.
 */
export type EffortSelection = EffortLevel | ''

/** One level the driver offers, with the label the driver chose for it. */
export interface EffortOption {
  value: EffortLevel
  label: string
}

/**
 * `GET /agents/{id}/effort` — the agent's effort capability.
 *
 * `levels` is the effective driver's level set, `default` the effective
 * config's default (`null` = the model default).
 */
export interface AgentEffort {
  supported: boolean
  levels: EffortOption[]
  default: EffortLevel | null
}
