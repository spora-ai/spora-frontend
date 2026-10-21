/**
 * Fixture for the extractor's template-literal rule.
 *
 * The rule has to catch operator copy that lives in a template literal and
 * stay quiet about the template literals that are everywhere else: DOM
 * ids, API paths, CSS values, class names, markup and log lines. A run
 * over the real `src/` proves nothing — that tree is clean by
 * construction — so the rule is exercised against this one instead.
 *
 * Every function below is named after what it is meant to prove.
 */
const log = {
  warn: (message: string): string => message,
}

/** A project logger — the rule has to recognise it by shape, not by name. */
const appLogger = {
  warn: (message: string): string => message,
}

/** OPERATOR COPY — the rule must report this one. */
export function operatorCopy(name: string): string {
  return `Remove ${name} from this group? They will lose access to every agent in it.`
}

/** OPERATOR COPY, opening with a hole — the rule must report this one too. */
export function operatorCopyFromHole(count: number): string {
  return `${count} scheduled runs`
}

/** DOM ID — one word, so the rule must stay quiet. */
export function domId(id: number): string {
  return `agent_row_${id}`
}

/** API PATH — the rule must stay quiet. */
export function apiPath(id: number): string {
  return `/agents/${id}/transfer`
}

/** CSS VALUE — the rule must stay quiet. */
export function cssValue(size: number): string {
  return `${size}px`
}

/** CLASS NAME — the rule must stay quiet. */
export function className(kind: string): string {
  return `card-${kind}-wide`
}

/** MARKUP — the rule must stay quiet. */
export function markup(id: number): string {
  return `<div class="row" data-id="${id}"></div>`
}

/** LOG LINE — the rule must stay quiet. */
export function logLine(id: number): string {
  log.warn(`[worker] task ${id} finished`)
}

/** DIAGNOSTIC on a result envelope — the rule must stay quiet. */
export function diagnostic(slug: string): { ok: boolean; error: string; message: string } {
  return { ok: false, error: 'invalid', message: `Invalid plugin slug: ${slug}` }
}

/** A `??` fallback is a value, not copy — the rule must stay quiet. */
export function fallback(status: number, host: string): string {
  const message = `Unreadable response from ${host}`
  return `HTTP ${status} ${message}`
}

/** QUERY STRING — the rule must stay quiet: the host and the API agree on it. */
export function queryString(page: number): string {
  return `?page=${page}`
}

/** SQL FRAGMENT — the rule must stay quiet: it is not a sentence. */
export function sqlFragment(id: number): string {
  return `SELECT id FROM agents WHERE id = ${id}`
}

/** JSON PAYLOAD — the rule must stay quiet: the host and the API agree on it. */
export function jsonPayload(name: string): string {
  return `{"name":"${name}"}`
}

/** A PROJECT LOGGER — the rule must stay quiet: it is a log line. */
export function projectLog(id: number): string {
  appLogger.warn(`[worker] task ${id} failed`)
}
