/**
 * The i18n extractor's CI rules, exercised against fixture trees.
 *
 * Every rule fails on an *absence* — a key that is missing, a value that is
 * not translated, a catalogue that is stale — so running the rules against
 * the real `src/` proves nothing: it is clean, and it stays clean no matter
 * how the rules are edited. Each case below builds a tree that is wrong in
 * exactly one way and asserts the rule catches it.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'i18n.mjs')

const COMPONENT = `<template>
  <button :title="t('Tooltip')">{{ t('Label') }}</button>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const label = t('Save')
</script>
`

/** The same component with the copy left outside `t()`. */
const UNTRANSLATED_COMPONENT = `<template>
  <button title="Untranslated tooltip">Untranslated label</button>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const label = t('Save')
</script>
`

interface Fixture {
  files: Record<string, string>
}

function run(files: Fixture, extraArgs: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-'))
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, contents)
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], {
      encoding: 'utf8',
    })
    return { code: result.status, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** A tree that passes every rule, so each case can break exactly one thing. */
function clean(): Fixture {
  return {
    'src/Widget.vue': COMPONENT,
    'src/locales/en.json': JSON.stringify({ Label: 'Label', Save: 'Save', Tooltip: 'Tooltip' }, null, 2) + '\n',
    'src/locales/de.json': JSON.stringify({ Save: 'Speichern', Label: 'Beschriftung', Tooltip: 'Kurzinfo' }, null, 2) + '\n',
  }
}

let tree: Fixture

beforeEach(() => {
  tree = clean()
})

afterEach(() => {
  tree = clean()
})

describe('i18n extractor', () => {
  it('passes a tree that satisfies every rule', () => {
    const { code, output } = run(tree, ['--check'])
    expect(output).toContain('3 keys')
    expect(code).toBe(0)
  })

  // `key in catalogue` walks the prototype chain, so `constructor`,
  // `toString` and `__proto__` all read as translated. These are plausible
  // English UI strings, and the failure is silent: the catalogue is reported
  // complete while shipping the English key untranslated.
  for (const inherited of ['constructor', 'toString', 'valueOf']) {
    it(`reports a missing translation for the key "${inherited}"`, () => {
      const withKey: Fixture = {
        ...clean(),
        'src/Widget.vue': COMPONENT.replace("t('Save')", `t('${inherited}')`),
      }
      const { code, output } = run(withKey, ['--check'])
      expect(output).toContain('missing')
      expect(output).toContain(inherited)
      expect(code).not.toBe(0)
    })
  }

  it('rejects a key carrying unescaped interpolation syntax', () => {
    tree['src/Widget.vue'] = COMPONENT.replace("t('Save')", "t('Welcome, {name}')")
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[syntax]')
    expect(output).toContain('"Welcome, {name}"')
    // The failure has to name the site, or the fix is a search.
    expect(output).toMatch(/src\/Widget\.vue:\d+/)
  })

  it('rejects a key carrying the plural separator', () => {
    tree['src/Widget.vue'] = COMPONENT.replace("t('Save')", "t('{n} item | {n} items')")
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[syntax]')
  })

  it('accepts the vue-i18n escape for a literal brace', () => {
    // The key as the *runtime* string and as it has to be *written* differ
    // by one level of escaping: the `.vue` source needs `\\{` for the JS
    // string literal to yield the `\{` that `@intlify/message-compiler`'s
    // TEXT_ESCAPES (/\\([\\@{}|])/g) then renders as a literal brace. The
    // extractor sees the runtime form, which is what lands in en.json.
    const runtimeKey = String.raw`Use \{braces\}`
    const sourceKey = String.raw`Use \\{braces\\}`
    tree['src/Widget.vue'] = COMPONENT.replace("t('Save')", `t('${sourceKey}')`)
    tree['src/locales/en.json'] = JSON.stringify(
      { Label: 'Label', Tooltip: 'Tooltip', [runtimeKey]: runtimeKey },
      null,
      2,
    ) + '\n'
    tree['src/locales/de.json'] = JSON.stringify(
      { [runtimeKey]: 'Geschweifte Klammern', Label: 'Beschriftung', Tooltip: 'Kurzinfo' },
      null,
      2,
    ) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(output).not.toContain('[syntax]')
    expect(code).toBe(0)
  })

  it('fails on en.json drift and says how to fix it', () => {
    tree['src/locales/en.json'] = JSON.stringify({ Stale: 'Stale' }, null, 2) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[drift]')
    expect(output).toContain('npm run i18n:extract')
  })

  it('fails when a target locale is missing a key, naming file:line', () => {
    tree['src/locales/de.json'] = JSON.stringify({}, null, 2) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[missing]')
    expect(output).toContain('"Save"')
    expect(output).toMatch(/src\/Widget\.vue:\d+/)
  })

  it('fails on a translation the source no longer has — a copy edit orphaned it', () => {
    tree['src/locales/de.json'] = JSON.stringify(
      { Save: 'Speichern', 'Save file': 'Datei speichern' },
      null,
      2,
    ) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[orphan]')
    expect(output).toContain('"Save file"')
  })

  it('fails on an empty translation', () => {
    tree['src/locales/de.json'] = JSON.stringify({ Save: '' }, null, 2) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[placeholder]')
    expect(output).toContain('empty')
  })

  it('fails on a translation left identical to the English source', () => {
    tree['src/locales/de.json'] = JSON.stringify({ Save: 'Save' }, null, 2) + '\n'
    const { code, output } = run(tree, ['--check'])
    expect(code).toBe(1)
    expect(output).toContain('[placeholder]')
    expect(output).toContain('English-identical')
  })

  it('fails on raw text outside $t() — every operator-facing string is catalogued', () => {
    tree['src/Widget.vue'] = UNTRANSLATED_COMPONENT
    const { code, output } = run(tree, ['--check'])
    expect(output).toContain('Untranslated label')
    expect(output).toContain('Untranslated tooltip')
    expect(output).toContain('[raw-text]')
    expect(code).not.toBe(0)
  })

  it('reaches DOM text written outside any template', () => {
    tree['src/copyCode.ts'] = "document.body.appendChild(document.createTextNode('Copied!'))\n"
    const { output } = run(tree, ['--check'])
    expect(output).toContain('Copied!')
    expect(output).toContain('src/copyCode.ts')
  })

  it('reaches constants in a .ts module', () => {
    tree['src/cron.ts'] = "export const DAYS = [{ value: 0, label: 'Sunday' }] as const\n"
    const { output } = run(tree, ['--check'])
    expect(output).toContain('Sunday')
    expect(output).toContain('src/cron.ts')
  })

  it('regenerates en.json as a flat identity map', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-'))
    try {
      mkdirSync(join(root, 'src/locales'), { recursive: true })
      writeFileSync(join(root, 'src/Widget.vue'), COMPONENT)
      writeFileSync(
        join(root, 'src/locales/de.json'),
        JSON.stringify({ Save: 'Speichern' }, null, 2) + '\n',
      )
      const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      const written = JSON.parse(
        readFileSync(join(root, 'src/locales/en.json'), 'utf8'),
      )
      expect(written).toEqual({ Save: 'Save', Label: 'Label', Tooltip: 'Tooltip' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})