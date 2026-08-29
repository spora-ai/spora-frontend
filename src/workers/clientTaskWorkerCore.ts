/**
 * clientTaskWorkerCore — runtime-agnostic tick + housekeeping loop.
 *
 * Drives `POST /api/v1/tasks/{taskId}/tick` on a fixed interval for every
 * task the user has explicitly `consider-task`'d, and `POST
 * /api/v1/worker/housekeeping` on a longer interval to reap orphans +
 * dispatch scheduled runs. Runs inside a SharedWorker (preferred) or
 * a dedicated Worker (fallback); both wrappers adapt the same message
 * channel to a {@link ClientWorkerCoreOptions} `port` so this module
 * never imports `self`.
 *
 * Message protocol:
 *   IN  { type: 'init', ... }
 *   IN  { type: 'consider-task', taskId, leaseOwner }
 *   IN  { type: 'drop-task', taskId }
 *   IN  { type: 'shutdown' }
 *   OUT { type: 'status', status: 'idle'|'booting'|'active'|'degraded'|'error',
 *         reason: string|null, drivenTaskCount: number }
 *   OUT { type: 'tick-start', taskId }
 *   OUT { type: 'tick-result', taskId, ok, status?, errorCode?, task? }
 *
 * The `task` field on `tick-result` carries the server's `taskResource()`
 * payload for the ticked row (only on 2xx responses with a JSON body).
 * The SPA applies it via `useTaskStore().applyTaskUpdate` so the chat
 * surfaces the new history + tool_calls without waiting for the next
 * 2 s `startDetailPolling` cycle — the difference between "live" and
 * "the task ran and we're showing you the finished state".
 *
 * `tick-start` is emitted immediately before the `/tick` fetch fires so
 * the SPA can flip a per-task "driving" flag and show the in-flight
 * spinner (see `tickProgressLabel` in `TaskChatMessageList.vue`). The
 * flag is cleared on the matching `tick-result`. Without this, the
 * chat has no in-flight signal: the server's tick is synchronous
 * (status never goes RUNNING on the wire — Mercure would normally
 * publish it but the typical shared-host deployment has no Mercure),
 * so the only window where the SPA knows the worker is actively
 * working is between the fetch firing and its response landing.
 */

export interface ClientWorkerInit {
  type: 'init'
  userId: number
  csrfToken: string
  tickEndpoint: string
  housekeepingEndpoint: string
  tickIntervalMs: number
  housekeepingIntervalSeconds: number
  tickLeaseSeconds: number
  baseUrl: string
}

export interface ConsiderTaskMsg { type: 'consider-task'; taskId: number; leaseOwner: string }
export interface DropTaskMsg { type: 'drop-task'; taskId: number }
export interface ShutdownMsg { type: 'shutdown' }

export type InMsg = ClientWorkerInit | ConsiderTaskMsg | DropTaskMsg | ShutdownMsg

export type Status = 'idle' | 'booting' | 'active' | 'degraded' | 'error'

export interface StatusMsg {
  type: 'status'
  status: Status
  reason: string | null
  drivenTaskCount: number
}

export interface TickStartMsg {
  type: 'tick-start'
  taskId: number
}

export interface TickResultMsg {
  type: 'tick-result'
  taskId: number
  ok: boolean
  status: number | null
  errorCode: string | null
  /** Post-tick task row from the server's `taskResource()`. Only present
   *  on 2xx responses with a JSON body. Typed as `TaskLikePayload` (a
   *  structural subset of the server's response) so the discriminated
   *  union doesn't widen to `unknown`; the consumer in
   *  `useClientWorker.ts` casts the full payload back to `TaskDetail`
   *  before forwarding to the task store. */
  task?: TaskLikePayload
}

/**
 * Structural subset of the server's `taskResource()` payload — the
 * fields the worker actually reads off the response (status + step
 * count for the log line). Avoids `unknown` in the discriminated
 * union and keeps the worker decoupled from the SPA's full
 * `TaskDetail` type.
 */
export interface TaskLikePayload {
  status?: string
  step_count?: number
}

export type OutMsg = StatusMsg | TickStartMsg | TickResultMsg

/**
 * The minimal surface this module needs from the host worker. `fetch` is
 * injected so tests can swap it; `port.postMessage` is the wire back to
 * the page (or, in shared-worker mode, to a single connected client);
 * `setTimeout` / `clearTimeout` / `now` are all overridable so the test
 * suite can drive the loop with `vi.useFakeTimers()`.
 */
export interface ClientWorkerCoreOptions {
  fetch: typeof fetch
  port: { postMessage: (msg: OutMsg) => void }
  setTimeout: (cb: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

interface DrivenTask {
  leaseOwner: string
  /** Last time we kicked the tick loop for this task — used to drop
   *  tasks whose lease has gone stale and the user never re-considered. */
  lastConsideredAt: number
}

export interface ClientWorkerCore {
  handle(msg: InMsg): void
  /** Test seam: returns the snapshot of driven tasks. */
  getDrivenTasks(): Array<{ taskId: number; leaseOwner: string }>
}

/**
 * Mirrors the `WorkerRunCommand` server-side log lines the operator
 * would see from `php bin/spora worker:run`. Disabled when
 * `localStorage['spora-client-worker-debug'] === '0'` so a noisy
 * local debug session can be silenced without rebuilding. Default ON
 * — the worker is debuggable by design.
 */
function debugEnabled(): boolean {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem('spora-client-worker-debug') !== '0'
  } catch {
    return true
  }
}

/**
 * Pull a numeric step count out of a `TaskLikePayload` without
 * coupling the worker to the SPA's full `TaskDetail` type. Returns 0
 * when the field is missing — the log line just shows "steps: 0"
 * instead of crashing on a malformed body.
 */
function readStepCount(task: TaskLikePayload | undefined): number {
  if (task === undefined) return 0
  return typeof task.step_count === 'number' ? task.step_count : 0
}

/**
 * "RUNNING, steps: 2" — used for the tick-completed log line so the
 * operator can see at a glance what state the worker left the row in.
 */
function summariseTask(task: TaskLikePayload | undefined, stepCount: number): string {
  const status = task?.status ?? 'unknown'
  return `${status}, steps: ${stepCount}`
}

/**
 * Surface an arbitrary thrown value as a string for the warn log —
 * `Error.message` for known errors, `String(...)` for the rest so the
 * operator always sees *something* useful.
 */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function createClientWorkerCore(opts: ClientWorkerCoreOptions): ClientWorkerCore {
  const { fetch: doFetch, port, setTimeout: schedule, clearTimeout: cancel, now } = opts

  const log = {
    info(message: string): void {
      if (!debugEnabled()) return
      console.info(message)
    },
    warn(message: string): void {
      if (!debugEnabled()) return
      console.warn(message)
    },
  }

  // De-dupe consider-task for the same leaseOwner — SSE can deliver the
  // same QUEUED event multiple times across reconnects, and we must not
  // double-tick. The server's lease is the source of truth, so the loop
  // itself is stateless w.r.t. this map.
  const drivenTasks = new Map<number, DrivenTask>()

  let tickIntervalMs = 0
  let housekeepingIntervalMs = 0
  let tickEndpoint = ''
  let housekeepingEndpoint = ''
  let csrfToken = ''
  let baseUrl = ''
  let tickTimer: unknown = null
  let housekeepingTimer: unknown = null
  let booted = false

  function postStatus(status: Status, reason: string | null): void {
    port.postMessage({ type: 'status', status, reason, drivenTaskCount: drivenTasks.size })
  }

  function postTickResult(taskId: number, ok: boolean, status: number | null, errorCode: string | null, task?: TaskLikePayload): void {
    port.postMessage({ type: 'tick-result', taskId, ok, status, errorCode, task })
  }

  function postTickStart(taskId: number): void {
    // Fired immediately before each `/tick` fetch so the SPA can flip
    // a per-task "driving" flag and show the in-flight spinner. The
    // matching `tick-result` clears it. See the protocol header for
    // why this is necessary — the server tick is synchronous, so the
    // SPA has no other "worker is actively working" signal.
    port.postMessage({ type: 'tick-start', taskId })
  }

  function buildTickUrl(taskId: number): string {
    // The server returns a templated path like `/api/v1/tasks/{taskId}/tick`
    // so we substitute once here rather than building the URL on every
    // tick loop iteration.
    return baseUrl + tickEndpoint.replace('{taskId}', String(taskId))
  }

  async function tickOnce(taskId: number, leaseOwner: string): Promise<void> {
    const url = buildTickUrl(taskId)
    const startedAt = now()
    postTickStart(taskId)
    log.info(`[client-worker] Processing task ${taskId}…`)
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-Tick-Lease-Owner': leaseOwner,
        },
        body: JSON.stringify({}),
      })
    } catch (e) {
      // Network blip — keep the task in `drivenTasks` so the next tick
      // interval retries. The server has the lease; if it's expired the
      // drop on the next successful 409 will catch up.
      log.warn(`[client-worker] Tick ${taskId} network error: ${describeError(e)}`)
      return
    }

    if (response.ok) {
      // Pull the taskResource body so the SPA can apply it immediately.
      // On a non-JSON 2xx we proceed without it — the SPA's
      // `startDetailPolling` will pick up the new state on the next cycle.
      let task: TaskLikePayload | undefined
      try {
        const body = await response.json() as { data?: { task?: TaskLikePayload } }
        task = body?.data?.task
      } catch {
        // Body wasn't JSON — proceed without it.
      }
      const ms = now() - startedAt
      const stepCount = readStepCount(task)
      log.info(`[client-worker] Task ${taskId} tick completed in ${ms}ms — ${summariseTask(task, stepCount)}`)
      postTickResult(taskId, true, response.status, null, task)
      return
    }

    if (response.status === 409) {
      // TICK_LOST_RACE / TICK_ALREADY_RUNNING — another taker beat us
      // (most often the browser tab that owned the lease was closed
      // and the new tab took over). Drop locally so we stop hammering.
      drivenTasks.delete(taskId)
      postStatus('active', null)
      let errorCode: string | null = 'TICK_LOST_RACE'
      try {
        const body = await response.json() as { error?: { code?: string } }
        errorCode = body.error?.code ?? errorCode
      } catch {
        // Body wasn't JSON — keep the default.
      }
      log.warn(`[client-worker] Tick ${taskId} lost race (409 — ${errorCode})`)
      postTickResult(taskId, false, response.status, errorCode)
      return
    }

    // Other non-2xx (rate limit, auth, server error) — log and retry.
    // We don't drop the task because the transient may pass on the
    // next interval; the server's lease keeps state consistent.
    log.warn(`[client-worker] Tick ${taskId} failed: HTTP ${response.status}`)
    postTickResult(taskId, false, response.status, null)
  }

  function runTickLoop(): void {
    for (const [taskId, task] of drivenTasks) {
      void tickOnce(taskId, task.leaseOwner)
    }
    // The tick timer is one-shot (`setTimeout`, not `setInterval`) so the
    // loop must re-arm itself. Without this, multi-step tasks get stuck
    // after one tick — the LLM returns a tool call, the row goes back to
    // QUEUED, and the worker never wakes up to drive the next step. The
    // first fire comes from `startTimers`; every subsequent fire comes
    // from here.
    if (tickTimer !== null && tickIntervalMs > 0) {
      tickTimer = schedule(runTickLoop, tickIntervalMs)
    }
  }

  async function runHousekeepingLoop(): Promise<void> {
    const startedAt = now()
    try {
      const response = await doFetch(baseUrl + housekeepingEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({}),
      })
      if (response.status === 429) {
        // Rate-limited — try again on the next interval; the server
        // already enforces the backoff.
        log.warn('[client-worker] Housekeeping rate-limited (HTTP 429)')
      } else if (response.ok) {
        const ms = now() - startedAt
        log.info(`[client-worker] Housekeeping tick completed in ${ms}ms`)
      } else {
        log.warn(`[client-worker] Housekeeping tick failed: HTTP ${response.status}`)
      }
      // 2xx: success. Other non-2xx: log and retry next tick. The
      // housekeeping endpoint is idempotent so a transient failure
      // is safe to repeat.
    } catch (e) {
      log.warn(`[client-worker] Housekeeping network error: ${describeError(e)}`)
      // Network blip — silent retry on next interval.
    } finally {
      // Same re-arm pattern as the tick loop above — without this the
      // housekeeping endpoint runs exactly once after init, leaving
      // orphans and scheduled runs to accumulate until the worker is
      // restarted manually.
      if (housekeepingTimer !== null && housekeepingIntervalMs > 0) {
        housekeepingTimer = schedule(() => { void runHousekeepingLoop() }, housekeepingIntervalMs)
      }
    }
  }

  function startTimers(): void {
    if (tickIntervalMs > 0 && tickTimer === null) {
      tickTimer = schedule(runTickLoop, tickIntervalMs)
    }
    if (housekeepingIntervalMs > 0 && housekeepingTimer === null) {
      housekeepingTimer = schedule(() => { void runHousekeepingLoop() }, housekeepingIntervalMs)
    }
  }

  function stopTimers(): void {
    if (tickTimer !== null) {
      cancel(tickTimer)
      tickTimer = null
    }
    if (housekeepingTimer !== null) {
      cancel(housekeepingTimer)
      housekeepingTimer = null
    }
  }

  function start(init: ClientWorkerInit): void {
    if (booted) return
    booted = true
    csrfToken = init.csrfToken
    baseUrl = init.baseUrl
    tickEndpoint = init.tickEndpoint
    housekeepingEndpoint = init.housekeepingEndpoint
    tickIntervalMs = init.tickIntervalMs
    housekeepingIntervalMs = init.housekeepingIntervalSeconds * 1000
    log.info(`[client-worker] Bootstrapping (userId=${init.userId}, tick=${tickIntervalMs}ms, housekeeping=${housekeepingIntervalMs}ms)`)
    startTimers()
    postStatus('active', null)
  }

  function shutdown(): void {
    stopTimers()
    drivenTasks.clear()
    booted = false
    log.info('[client-worker] Worker offline')
    postStatus('idle', null)
  }

  function considerTask(taskId: number, leaseOwner: string): void {
    const existing = drivenTasks.get(taskId)
    if (existing?.leaseOwner === leaseOwner) {
      // Same owner re-considering — just refresh the timestamp.
      existing.lastConsideredAt = now()
      return
    }
    drivenTasks.set(taskId, { leaseOwner, lastConsideredAt: now() })
    log.info(`[client-worker] Considering task ${taskId} (leaseOwner=${leaseOwner}) — driven tasks: ${drivenTasks.size}`)
    postStatus('active', null)
  }

  function dropTask(taskId: number): void {
    if (drivenTasks.delete(taskId)) {
      postStatus('active', null)
    }
  }

  return {
    handle(msg: InMsg): void {
      switch (msg.type) {
        case 'init':
          start(msg)
          return
        case 'consider-task':
          considerTask(msg.taskId, msg.leaseOwner)
          return
        case 'drop-task':
          dropTask(msg.taskId)
          return
        case 'shutdown':
          shutdown()
          return
      }
    },
    getDrivenTasks(): Array<{ taskId: number; leaseOwner: string }> {
      return Array.from(drivenTasks, ([taskId, t]) => ({ taskId, leaseOwner: t.leaseOwner }))
    },
  }
}