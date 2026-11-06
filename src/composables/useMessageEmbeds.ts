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
import { computed, ref, watch, type ComputedRef } from 'vue'
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

export interface MessageEmbeds {
  /** The message's segments: sanitised markup, and the frames it asks for. */
  segments: ComputedRef<MarkdownSegment[]>
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
 */
function plainLabel(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

export function useMessageEmbeds(content: string | null | undefined): MessageEmbeds {
  const mediaCache = useMediaAssetCache()
  const resolved = ref<Map<string, MediaAsset>>(new Map())

  const segments = computed<MarkdownSegment[]>(() => renderMarkdownSegments(content ?? ''))

  const assetIds = computed<string[]>(() =>
    segments.value.filter((s) => s.kind === 'embed').map((s) => s.assetId),
  )

  watch(
    assetIds,
    async (ids) => {
      if (ids.length === 0) {
        resolved.value = new Map()
        return
      }
      const assets = await mediaCache.batchResolve(ids)
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
    for (const segment of segments.value) {
      if (segment.kind !== 'embed') continue
      const asset = resolved.value.get(segment.assetId)
      const descriptor = asset?.embed_descriptor
      if (asset === undefined || descriptor === undefined || descriptor === null) {
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

  return { segments, embeds }
}
