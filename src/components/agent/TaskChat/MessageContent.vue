<script setup lang="ts">
/**
 * MessageContent — one assistant message, rendered.
 *
 * The message is markdown, and it may also ask for a live frame: a link
 * to an asset's embed route. The frame is a Vue component, and a
 * component cannot live inside the markup the sanitiser produced — so the
 * markdown is rendered as *segments* and the reference is one of them.
 *
 * Everything else is ordinary markdown, and renders as it always has.
 */
import { useMessageEmbeds, type MessageEmbed } from '@/composables/useMessageEmbeds'
import MediaEmbedFrame from '@/components/agent/TaskChat/MediaEmbedFrame.vue'

const props = defineProps<{
  content: string | null | undefined
}>()

const { segments, embeds } = useMessageEmbeds(props.content)

function embedFor(assetId: string): MessageEmbed | undefined {
  return embeds.value.get(assetId)
}
</script>

<template>
  <template
    v-for="(segment, index) in segments"
    :key="index"
  >
    <div
      v-if="segment.kind === 'html'"
      v-html="segment.html"
    />
    <!--
      An asset the caller cannot see, or one the operator has not
      permitted, has no descriptor. Its reference stays the link the
      model wrote — the operator can still open it, and the sandbox the
      embed route applies is the same one the download path gets.
    -->
    <MediaEmbedFrame
      v-else-if="embedFor(segment.assetId)"
      :url="embedFor(segment.assetId)!.url"
      :mime="embedFor(segment.assetId)!.mime"
      :scripts="embedFor(segment.assetId)!.scripts"
      :label="embedFor(segment.assetId)!.label"
    />
    <a
      v-else
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-primary underline underline-offset-2 hover:opacity-80"
    >{{ segment.label }}</a>
  </template>
</template>
