/**
 * useToolSettingOptions — fetch + normalize options for a multi-select
 * ToolSetting field.
 *
 * The ToolSetting attribute carries an optional `data_source` URL; the
 * renderer passes it here. The endpoint may return either of two
 * shapes — the composable normalises both into a uniform
 * `MultiSelectOption[]`:
 *
 *   - Agents (HandoverTool default):  `[{id, name}]`
 *     → `{ value: id, label: \`${name} #${id}\` }`
 *   - Skills (Skill tool):            `[{name, description}]`
 *     → `{ value: name, label: name, description }`
 *
 * Detection is by item shape (presence of `id`), not by endpoint name,
 * so future endpoints that ship their own option shape are easy to add
 * by extending the mapper.
 *
 * The composable is stateless: `load()` returns a Promise the caller
 * awaits (typically in `onMounted`); `options`/`loading`/`error` are
 * reactive refs for the template.
 */
import { ref, unref, type ComputedRef, type Ref } from 'vue'
import { api } from '@/api/client'
import { log } from '@/utils/logger'

export interface MultiSelectOption {
  value: string | number
  label: string
  description?: string
}

export interface UseToolSettingOptionsReturn {
  options: Ref<MultiSelectOption[]>
  loading: Ref<boolean>
  error: Ref<unknown>
  load: () => Promise<void>
}

interface RawAgentOption {
  id: number
  name: string
}

interface RawSkillOption {
  name: string
  description?: string
}

/**
 * Shape an option from the agents endpoint (id + name) into the
 * uniform option shape. Used by HandoverTool.
 */
function mapAgentOption(raw: RawAgentOption): MultiSelectOption {
  return { value: raw.id, label: `${raw.name} #${raw.id}` }
}

/**
 * Shape an option from the skills endpoint (name + description) into
 * the uniform option shape. Used by the Skill tool.
 */
function mapSkillOption(raw: RawSkillOption): MultiSelectOption {
  const opt: MultiSelectOption = { value: raw.name, label: raw.name }
  if (typeof raw.description === 'string' && raw.description !== '') {
    opt.description = raw.description
  }
  return opt
}

/**
 * Extract the inner array from `{agents}`, `{skills}`, `{options}`, or
 * `{data}` response wrappers, while preserving bare arrays.
 */
function extractList(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') {
    return []
  }
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj.agents)) {
    return obj.agents
  }
  if (Array.isArray(obj.skills)) {
    return obj.skills
  }
  if (Array.isArray(obj.options)) {
    return obj.options
  }
  if (Array.isArray(obj.data)) {
    return obj.data
  }
  if (Array.isArray(data)) {
    return data
  }
  return []
}

export function useToolSettingOptions(endpoint: Ref<string> | ComputedRef<string> | string): UseToolSettingOptionsReturn {
  const options = ref<MultiSelectOption[]>([])
  const loading = ref(false)
  const error = ref<unknown>(null)

  async function load(): Promise<void> {
    const resolvedEndpoint = unref(endpoint)
    loading.value = true
    error.value = null
    try {
      const res = await api.get(resolvedEndpoint)
      const raw = extractList(res)
      options.value = raw.map((item): MultiSelectOption => {
        if (item && typeof item === 'object' && 'id' in item) {
          return mapAgentOption(item as RawAgentOption)
        }
        return mapSkillOption(item as RawSkillOption)
      })
    } catch (e) {
      // Render an empty list rather than letting the rejection escape an
      // async lifecycle hook; the caller can read `error` if needed.
      log.warn(`[useToolSettingOptions] failed to load options from ${resolvedEndpoint}; rendering empty list`, e)
      error.value = e
      options.value = []
    } finally {
      loading.value = false
    }
  }

  return { options, loading, error, load }
}
