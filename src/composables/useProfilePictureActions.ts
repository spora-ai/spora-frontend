/**
 * useProfilePictureActions — bridges the cross-subject
 * {@link ProfilePictureSection} props (`commit`, `upload`, `remove`)
 * to a per-subject Pinia store. Both Agent and Group wrappers pass
 * the same shape of store actions, so the bridging is one-line per
 * call.
 *
 * The composable returns the three functions with the subject id
 * pre-bound so the wrapper components stay declarative — they
 * render `<ProfilePictureSection v-bind="actions" />` instead of
 * defining three near-identical `commit` / `upload` / `remove`
 * async functions each.
 *
 * The store-side actions don't have to share a base type (the agent
 * store returns `Promise<Agent>`, the group store `Promise<Group>`)
 * — `Promise<unknown>` is the contract the composable promises
 * upward. Callers that need the typed subject can `await` and read
 * the result themselves.
 */

export interface ProfilePicturePatch {
  archetype?: string | null
  variant_key?: string | null
  palette_key?: string | null
}

export interface ProfilePictureActionsBundle {
  commit: (patch: ProfilePicturePatch) => Promise<void>
  upload: (file: File) => Promise<void>
  remove: () => Promise<void>
}

export interface ProfilePictureStoreActions {
  update: (id: number, patch: ProfilePicturePatch) => Promise<unknown>
  upload: (id: number, file: File) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}

export function useProfilePictureActions(
  subjectId: number,
  actions: ProfilePictureStoreActions,
): ProfilePictureActionsBundle {
  return {
    commit: (patch) => actions.update(subjectId, patch).then(() => undefined),
    upload: (file) => actions.upload(subjectId, file).then(() => undefined),
    remove: () => actions.remove(subjectId).then(() => undefined),
  }
}
