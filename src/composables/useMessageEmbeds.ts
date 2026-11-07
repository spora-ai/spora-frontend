/**
 * useMessageEmbeds — the live frames a message asks for.
 *
 * A model shows a widget by linking its embed route:
 *
 *     [test-dashboard.html](/api/v1/media/<asset_id>/embed)
 *
 * The chat renders that link as a frame, in place, so the operator sees
 * the widget in the conversation rather than in a tool call they have to
 * go looking for. The model never sees the asset's bytes — it writes a
 * reference, the way it writes a link to a file.
 *
 * The frame is a Vue component, so the markdown is rendered as *segments*
 * and the reference is one of them: a component cannot live inside the
 * markup the sanitiser produced.
 *
 * The descriptor comes from the server, not from the reference: the
 * server decides whether an embed exists and whether its scripts may run,
 * and the client mirrors that decision in the frame's `sandbox`
 * attribute. The response's CSP header is the ceiling the browser
 * enforces.
 */
import { computed, ref, watch, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { renderMarkdownSegments, type MarkdownSegment } from '@/composables/useMarkdown'
import { useMediaAssetCache } from '@/composables/useMediaAssetCache'
import type { MediaAsset } from '@/types/media'

export interface MessageEmbed {
  /** The asset the reference names. */
  assetId: string
  /** The link's own text — what the operator reads if it cannot be framed. */
  label: string
  /** The frame's `src`: the embed route, which the server serves. */
  url: string
  /** The asset's MIME type, for the frame's title. */
  mime: string
  /** Whether the operator permitted the embedded scripts to run. */
  scripts: boolean
}

/**
 * One piece of a message, with the frame it asks for already resolved.
 *
 * `embed` is null for a reference the caller cannot see, or one the
 * operator has not permitted — the reference then stays the link the
 * model wrote.
 */
export type ResolvedSegment =
  | { kind: 'html'; key: string; html: string }
  | {
      kind: 'embed'
      key: string
      assetId: string
      label: string
      href: string
      embed: MessageEmbed | null
    }

export interface MessageEmbeds {
  /** The message's segments, with their frames resolved. */
  segments: ComputedRef<ResolvedSegment[]>
  /**
   * The frames, keyed by asset id. An asset the caller cannot see, or
   * one the operator has not permitted, is simply absent — and its
   * reference stays a link.
   */
  embeds: ComputedRef<Map<string, MessageEmbed>>
}

/**
 * The link's text, without the markup the renderer put in it.
 *
 * The label ends up in the frame's `title` attribute, and an attribute
 * is text — the markup in it would be read as markup.
 *
 * The scan is a loop rather than a pattern: a pattern that matches from
 * one `<` to the next `>` restarts at every `<` when the text has no
 * closing bracket, which is quadratic in the label's length, and the
 * label is the model's to write.
 */
function plainLabel(html: string): string {
  let text = ''
  let inTag = false
  for (const char of html) {
    if (char === '<') {
      inTag = true
      continue
    }
    if (char === '>') {
      inTag = false
      continue
    }
    if (!inTag) text += char
  }
  return decodeEntities(text).trim()
}

/**
 * The entities the renderer escapes, decoded again.
 *
 * `&amp;` is last, so an escaped `&amp;lt;` comes back as the text
 * `&lt;` and not as `<`.
 */
function decodeEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

/**
 * Whether a URL is a path on this origin.
 *
 * A root-relative path is same-origin by construction. A protocol-relative
 * URL (`//host/path`) is not — it resolves against the current scheme and
 * points elsewhere — so it is rejected alongside an absolute URL.
 *
 * The server builds the URL, but the client does not take it on trust:
 * the frame's `src` is a stronger primitive than the `src` of the images
 * the same descriptors feed, and a descriptor naming another origin
 * would put that origin's document on the operator's page.
 */
function isSameOriginPath(url: string): boolean {
  if (!url.startsWith('/')) return false
  return !url.startsWith('//')
}

/**
 * The live frames the message at `content` asks for.
 *
 * `content` is a getter, not a string: a message's text changes while
 * the chat is open — the agent's answer lands after the turn it belongs
 * to — and a plain string captured once would leave the message showing
 * the first text it ever had.
 */
export function useMessageEmbeds(
  content: MaybeRefOrGetter<string | null | undefined>,
): MessageEmbeds {
  const mediaCache = useMediaAssetCache()
  const resolved = ref<Map<string, MediaAsset>>(new Map())

  const markdown = computed<MarkdownSegment[]>(() =>
    renderMarkdownSegments(toValue(content) ?? ''),
  )

  const assetIds = computed<string[]>(() =>
    markdown.value.filter((s) => s.kind === 'embed').map((s) => s.assetId),
  )

  watch(
    assetIds,
    async (ids) => {
      if (ids.length === 0) {
        resolved.value = new Map()
        return
      }
      const assets = await mediaCache.batchResolve(ids)
      // A resolve that lands after the message moved on would leave the
      // frame describing an asset the message no longer mentions.
      if (ids.join(',') !== assetIds.value.join(',')) return
      const next = new Map<string, MediaAsset>()
      for (const id of ids) {
        const asset = assets.get(id)
        if (asset !== undefined) {
          next.set(id, asset)
        }
      }
      resolved.value = next
    },
    { immediate: true },
  )

  const embeds = computed<Map<string, MessageEmbed>>(() => {
    const out = new Map<string, MessageEmbed>()
    for (const segment of markdown.value) {
      if (segment.kind !== 'embed') continue
      const asset = resolved.value.get(segment.assetId)
      const descriptor = asset?.embed_descriptor
      if (asset === undefined || descriptor === undefined || descriptor === null) {
        continue
      }
      if (!isSameOriginPath(descriptor.url)) {
        continue
      }
      out.set(segment.assetId, {
        assetId: segment.assetId,
        label: plainLabel(segment.label),
        url: descriptor.url,
        mime: descriptor.mime,
        scripts: descriptor.scripts,
      })
    }
    return out
  })

  const segments = computed<ResolvedSegment[]>(() =>
    markdown.value.map((segment, index) => {
      if (segment.kind === 'html') {
        return { kind: 'html', key: `html-${index}`, html: segment.html }
      }
      return {
        kind: 'embed',
        key: `embed-${segment.assetId}`,
        assetId: segment.assetId,
        label: segment.label,
        href: segment.href,
        embed: embeds.value.get(segment.assetId) ?? null,
      }
    }),
  )

  return { segments, embeds }
}
