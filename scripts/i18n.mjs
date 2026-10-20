#!/usr/bin/env node
/**
 * i18n extractor — generates `src/locales/en.json` from the source and
 * enforces the catalogue contract.
 *
 *   node scripts/i18n.mjs            regenerate en.json, report gaps
 *   node scripts/i18n.mjs --check    enforce the four CI rules, no writes
 *   node scripts/i18n.mjs --root DIR scan a fixture tree instead of this repo
 *
 * Built on the two parsers already in the tree (`vue-eslint-parser` and
 * `@typescript-eslint/typescript-estree`) rather than
 * `@intlify/unplugin-vue-i18n`, because the failure output has to name
 * `file:line` and the catalogue is generated from literals rather than from
 * `<i18n>` blocks.
 *
 * Two things come out of a scan and they are not the same thing:
 *
 *   keys       literal `$t('…')` / `t('…')` arguments. These are the
 *              catalogue. en.json is their identity map.
 *   candidates  operator-facing literals that are NOT yet wrapped in `t()`.
 *              Since the migration closed, these fail the check: every
 *              operator-facing string goes through the catalogue.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseForESLint as parseVueForESLint } from 'vue-eslint-parser'
// The namespace, not the bare `parse` function: vue-eslint-parser looks for
// a `parse` / `parseForESLint` *property* and falls back to espree when it
// is handed a bare function.
import * as tsEstree from '@typescript-eslint/typescript-estree'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const verbose = args.includes('--verbose')

/**
 * `--root` points the scan at a different tree. It exists so the CI rules
 * can be exercised against a fixture — the rules only fail on *absence*, so
 * testing them against the real `src/` (which is clean) proves nothing.
 */
const rootFlag = args.indexOf('--root')
const ROOT = rootFlag === -1
  ? fileURLToPath(new URL('..', import.meta.url))
  : resolve(process.cwd(), args[rootFlag + 1])
const SOURCE_DIR = join(ROOT, 'src')
const CATALOGUE_DIR = join(SOURCE_DIR, 'locales')
const SOURCE_LOCALE = 'en'
const TARGET_LOCALES = ['de']

/** Attribute names whose literal value is operator-facing copy. */
const LITERAL_ATTRIBUTES = new Set([
  'placeholder',
  'title',
  'aria-label',
  'label',
  'alt',
])

/**
 * Object properties whose literal string value is operator-facing copy in a
 * `.ts` module. This is the rule that catches the surfaces a `.vue`-only
 * extractor cannot see: `DAY_OF_WEEK_OPTIONS`' `label`, the wizard's
 * frequency labels, the composables' default dialog copy.
 */
const COPY_PROPERTIES = new Set([
  'label',
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'description',
  'message',
  'text',
  'displayName',
  'category',
  'confirmLabel',
  'cancelLabel',
  'confirmText',
  'cancelText',
])

/**
 * Functions that put a literal string straight into the DOM. `copyCode.ts`
 * writes button text through `document.createTextNode`, which no template
 * walk can ever see.
 */
const DOM_TEXT_FUNCTIONS = new Set(['createTextNode'])

/**
 * Callee roots whose calls log rather than message. A template literal in
 * a log line is developer output: the operator never reads it, and
 * translating it would turn a diagnostic into nonsense.
 */
const LOGGING_ROOTS = new Set(['console', 'log', 'logger'])

/**
 * Copy properties whose template-literal value is a diagnostic for the
 * developer rather than copy the operator reads. `message` on a result
 * envelope — `{ ok: false, error: 'invalid', message: … }` — is the
 * host's own wording; the operator sees the state, not the message.
 */
const DIAGNOSTIC_PROPERTIES = new Set(['message'])

const SCAN_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx'])

// ---------------------------------------------------------------------------
// Syntax rejection
// ---------------------------------------------------------------------------

/**
 * vue-i18n's message syntax, verified against
 * `@intlify/message-compiler`'s `TEXT_ESCAPES` (`/\\([\\@{}|])/g`):
 *
 *   `{` / `}`  named interpolation      `t('Hi {name}')`
 *   `|`        plural separator         `t('{n} item | {n} items', { n })`
 *   `\{` `}` `\|` `\\` `\@`  escapes that render the character literally
 *
 * So the extractor strips the escapes and rejects whatever is left. A key
 * carrying a raw `{` is not a lint nit: it is a key that either throws at
 * render or, once the message compiler is dropped from the build, silently
 * prints its own source — and the usual source of one is a JSON or CSS
 * snippet pasted into help text.
 */
const TEXT_ESCAPES = /\\([\\@{}|])/g

function syntaxProblem(key) {
  // Escapes are *consumed* by the compiler and rendered literally, so they
  // are removed rather than unwrapped: `Use \{braces\}` compiles to the
  // literal text `Use {braces}`, and unwrapping it would leave exactly the
  // braces this rule exists to reject.
  const stripped = key.replace(TEXT_ESCAPES, '')
  const found = ['{', '}', '|'].filter((ch) => stripped.includes(ch))
  return found.length > 0 ? found : null
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function listSourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full))
    } else if (
      SCAN_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.'))) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(full)
    }
  }
  return found.sort()
}

const rel = (file) => relative(ROOT, file).split(sep).join('/')

/**
 * Generic ESTree walk — no visitor-key table needed for literal harvesting.
 *
 * The visitor gets the chain of links from the root down to the node's
 * parent, each link being the parent and the key the node sits under. A
 * candidate needs that chain to know *where* it sits: the argument of a
 * `return`, one arm of a ternary, the body of a `switch` case, an element
 * of an array — none of which is a property, so the property rule never
 * saw them.
 */
function walk(node, visit, links = []) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, links)
    return
  }
  if (typeof node.type === 'string') visit(node, links)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const child = node[key]
    if (child !== null && typeof child === 'object') {
      walk(child, visit, links.concat([{ node, key }]))
    }
  }
}

/**
 * The name a call was made on, for both `t('…')` and `i18n.global.t('…')`.
 * Returns null for anything whose name cannot be read statically — a
 * computed member or a call result, where guessing would produce keys the
 * source does not contain.
 */
function calleeName(node) {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  if (callee.type === 'Identifier') return callee.name
  if (
    callee.type === 'MemberExpression' &&
    callee.computed !== true &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return null
}

/** The string a call was passed at argument 0, if it was passed a literal one. */
function stringArgument(args) {
  const first = args[0]
  if (first?.type === 'Literal' && typeof first.value === 'string') return first.value
  if (first?.type === 'TemplateLiteral' && first.expressions.length === 0) {
    return first.quasis[0].value.cooked ?? first.quasis[0].value.raw
  }
  return null
}

function propertyName(node) {
  if (node.computed === true) return null
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return null
}

/** A candidate is only worth reporting if it reads as prose. */
function looksLikeCopy(value) {
  if (value.trim() === '') return false
  return /[\p{L}]/u.test(value)
}

/**
 * The stricter test the copy positions need.
 *
 * A string that is the *output* of a helper is only copy when it reads as
 * a phrase. `return 'no_migrations'` and `return 'ok'` are values — a
 * status and an acknowledgement — and the loose test above would report
 * every one of them. Prose is more than one word, starts with a capital
 * and is not a path, a URL or a CSS class.
 */
function readsAsProse(value) {
  const v = value.trim()
  if (v === '') return false
  if (!/\p{L}/u.test(v)) return false
  if (!/\s/u.test(v)) return false
  if (!/^\p{Lu}/u.test(v)) return false
  if (v.includes('\\')) return false
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|\.{1,2}\/|~\/)/i.test(v)) return false
  return true
}

/**
 * The position a literal sits in, when that position is one the operator
 * reads but the property rule cannot see. Returns null for everything else.
 */
function copyPosition(links) {
  // A `switch` case body is a block, so the literal sits deeper than one
  // link down — the case is an ancestor rather than the parent. The case
  // is the more specific context, so it is reported as such.
  if (links.some((l) => l.node.type === 'SwitchCase' && l.key === 'consequent')) {
    return 'switch'
  }
  // The links run outermost first, so the innermost one is the parent.
  const link = links[links.length - 1]
  if (link === undefined) return null
  const { node, key } = link
  if (node.type === 'ReturnStatement' && key === 'argument') return 'return'
  if (
    node.type === 'ConditionalExpression' &&
    (key === 'consequent' || key === 'alternate')
  ) {
    return 'ternary'
  }
  if (node.type === 'ArrayExpression' && key === 'elements') return 'array'
  return null
}

/** Whether the literal is already inside a `t()` / `$t()` call. */
function insideTranslationCall(links) {
  return links.some(({ node }) => {
    if (node.type !== 'CallExpression') return false
    const name = calleeName(node)
    return name === 't' || name === '$t'
  })
}

/**
 * The dotted path of a call's callee — `toast.error`, `log.warn`.
 *
 * The property name alone is not enough: `toast.error` is a message the
 * operator reads and `log.error` is a log line nobody reads.
 */
function calleePath(node) {
  if (node.type === 'Identifier') return node.name
  if (
    node.type === 'MemberExpression' &&
    node.computed !== true &&
    node.property.type === 'Identifier'
  ) {
    const object = calleePath(node.object)
    return object === null ? null : `${object}.${node.property.name}`
  }
  return null
}

/**
 * The English text of a template literal: the literal characters with the
 * `${…}` holes left out.
 *
 * The holes are joined with a space so the two sides of a hole do not
 * fuse into one word — `Remove ${name} from this group?` reads as
 * "Remove from this group?", not as "Removefrom this group?".
 */
function templateText(node) {
  return node.quasis
    .map((quasi) => quasi.value.cooked ?? quasi.value.raw)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Whether the literal text of a template literal reads as prose.
 *
 * The `readsAsProse` test cannot be reused as it stands: a template
 * literal that opens with a hole has no capital of its own — the word is
 * inside the hole. So this test is on the words the literal carries:
 * at least two of them, and none of them a path, a URL, a CSS value or a
 * piece of markup.
 *
 * That word count is what keeps the rule quiet. Template literals are
 * everywhere — DOM ids, API paths, class names, byte counts — and they
 * are all one word.
 */
function templateReadsAsProse(node, text) {
  if (text === '') return false
  if (text.includes('\\')) return false
  // Markup: a tag, or an attribute assignment.
  if (/<\/?\p{L}/u.test(text)) return false
  if (/="/u.test(text)) return false
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|\.{1,2}\/|~\/|\/)/iu.test(text)) return false
  const words = text.match(/\p{L}[\p{L}\p{N}_'’]*(?:-\p{L}[\p{L}\p{N}_'’]*)*/gu) ?? []
  if (words.filter((word) => word.length >= 2).length < 2) return false
  // A template that opens with literal text opens a sentence, so it has
  // to start like one. A template that opens with a hole cannot.
  const first = (node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? '').trim()
  if (first === '' || !/^\p{L}/u.test(first)) return true
  return /^\p{Lu}/u.test(first)
}

/**
 * The position a template literal sits in, when that position is one the
 * operator reads.
 *
 * A template literal is its own ESTree node type, so the `Literal` rules
 * never reached it. This reads the same set of positions one node type
 * further out: a `return`, a ternary arm, an array element, a template
 * expression, a copy property, a call argument.
 *
 * A `||` / `??` fallback is skipped over, because the fallback inherits
 * the position of the expression it belongs to: `err?.message ?? \`HTTP
 * ${status}\`` is a value, while `plugin.description || \`Plugin slug:
 * ${slug}\`` is a sentence on screen.
 */
function templatePosition(links) {
  let index = links.length - 1
  while (index >= 0 && links[index].node.type === 'LogicalExpression') index -= 1
  if (index < 0) return null
  const { node, key } = links[index]
  if (node.type === 'ReturnStatement' && key === 'argument') return 'return'
  if (
    node.type === 'ConditionalExpression' &&
    (key === 'consequent' || key === 'alternate')
  ) {
    return 'ternary'
  }
  if (node.type === 'ArrayExpression' && key === 'elements') return 'array'
  if (node.type === 'AssignmentExpression' && key === 'right') return 'assignment'
  if (node.type === 'VExpressionContainer' && key === 'expression') return 'template'
  if (node.type === 'CallExpression' && key === 'arguments') {
    const path = calleePath(node.callee)
    if (path !== null && LOGGING_ROOTS.has(path.split('.')[0])) return null
    return 'call'
  }
  if (node.type === 'Property' && key === 'value') {
    const name = propertyName(node)
    if (name === null || !COPY_PROPERTIES.has(name)) return null
    if (DIAGNOSTIC_PROPERTIES.has(name)) return null
    return 'property'
  }
  return null
}

function scan() {
  const keys = new Map()
  const candidates = []
  const dynamic = []

  const addKey = (key, file, line) => {
    const existing = keys.get(key)
    if (existing === undefined) keys.set(key, [{ file, line }])
    else existing.push({ file, line })
  }

  const addCandidate = (value, file, line, kind) => {
    if (looksLikeCopy(value)) candidates.push({ value: value.trim(), file, line, kind })
  }

  /** One string, one report: a `switch` case whose body is a `return` sits in two positions at once. */
  const pushCandidate = (value, file, line, kind) => {
    const trimmed = value.trim()
    if (candidates.some((c) => c.file === file && c.line === line && c.value === trimmed)) {
      return
    }
    candidates.push({ value: trimmed, file, line, kind })
  }

  /**
   * The copy positions get the stricter test: a literal that is the output
   * of a helper is a value far more often than it is copy, and the loose
   * test reports every status code and every acknowledgement.
   */
  const addCopyCandidate = (value, file, line, kind) => {
    if (!readsAsProse(value)) return
    pushCandidate(value, file, line, kind)
  }

  const visitAst = (node, file) => {
    walk(node, (child, links) => {
      if (child.type === 'CallExpression') {
        const name = calleeName(child)
        if (name === 't' || name === '$t') {
          const key = stringArgument(child.arguments)
          if (key !== null) addKey(key, file, child.loc.start.line)
          // A spread is a helper forwarding another call's arguments, not a
          // key computed at runtime, so it is not worth reporting.
          else if (child.arguments[0]?.type !== 'SpreadElement') {
            dynamic.push({ file, line: child.loc.start.line })
          }
          return
        }
        if (DOM_TEXT_FUNCTIONS.has(name)) {
          const text = stringArgument(child.arguments)
          if (text !== null) addCandidate(text, file, child.loc.start.line, 'DOM text')
        }
        return
      }
      if (
        (child.type === 'Property' || child.type === 'PropertyDefinition') &&
        COPY_PROPERTIES.has(propertyName(child) ?? '') &&
        child.value?.type === 'Literal' &&
        typeof child.value.value === 'string'
      ) {
        addCandidate(child.value.value, file, child.loc.start.line, 'literal')
        return
      }
      if (child.type === 'TemplateLiteral') {
        // A template literal with no hole is a plain string literal with a
        // different syntax — the `Literal` rules already have it.
        if (child.expressions.length === 0) return
        if (insideTranslationCall(links)) return
        const kind = templatePosition(links)
        if (kind === null) return
        const text = templateText(child)
        if (!templateReadsAsProse(child, text)) return
        pushCandidate(text, file, child.loc.start.line, `template ${kind}`)
        return
      }
      if (child.type === 'Literal' && typeof child.value === 'string') {
        if (insideTranslationCall(links)) return
        const kind = copyPosition(links)
        if (kind === null) return
        addCopyCandidate(child.value, file, child.loc.start.line, kind)
      }
    })
  }

  for (const file of listSourceFiles(SOURCE_DIR)) {
    const code = readFileSync(file, 'utf8')
    const name = rel(file)

    if (file.endsWith('.vue')) {
      // `parseForESLint`, not `parse`: the latter returns the Program node
      // itself, so reading `.ast` off it yields `undefined` and the script
      // block is walked as if it were empty — no error, zero keys.
      const { ast } = parseVueForESLint(code, {
        filePath: file,
        ecmaVersion: 2022,
        sourceType: 'module',
        loc: true,
        range: true,
        comment: true,
        // vue-eslint-parser reaches the `<script lang="ts">` body through its
        // `parser` option; without it the default espree chokes on the first
        // type annotation in the file.
        parser: tsEstree,
      })

      visitAst(ast, name)

      const walkTemplate = (node) => {
        if (node.type === 'VDocumentFragment') {
          node.children.forEach(walkTemplate)
          return
        }
        if (node.type !== 'VElement') return

        for (const attribute of node.startTag.attributes) {
          if (attribute.directive !== false) {
            // `:placeholder="'…'"` — a bound literal is still a literal.
            const argName =
              attribute.key.name?.name === 'bind' ? attribute.key.argument?.name : null
            if (
              argName &&
              LITERAL_ATTRIBUTES.has(argName) &&
              attribute.value?.type === 'VExpressionContainer' &&
              attribute.value.expression?.type === 'Literal' &&
              typeof attribute.value.expression.value === 'string'
            ) {
              addCandidate(
                attribute.value.expression.value,
                name,
                attribute.value.loc.start.line,
                `:${argName}`,
              )
            }
            continue
          }
          const attrName = attribute.key.name
          if (
            attrName &&
            LITERAL_ATTRIBUTES.has(attrName) &&
            attribute.value?.type === 'VLiteral' &&
            typeof attribute.value.value === 'string'
          ) {
            addCandidate(attribute.value.value, name, attribute.loc.start.line, attrName)
          }
        }

        for (const child of node.children) {
          if (child.type === 'VText') {
            addCandidate(child.value, name, child.loc.start.line, 'raw text')
          } else if (child.type === 'VExpressionContainer' && child.expression) {
            // Template expressions are ESTree and are not part of the
            // `<script>` AST, so they need the same walk to find
            // `{{ $t('…') }}` and `{{ t('…') }}`.
            visitAst(child.expression, name)
          } else {
            walkTemplate(child)
          }
        }
      }

      if (ast.templateBody != null) walkTemplate(ast.templateBody)
    } else {
      const ast = tsEstree.parse(code, {
        filePath: file,
        ecmaVersion: 2022,
        sourceType: 'module',
        loc: true,
        range: true,
        comment: true,
      })
      visitAst(ast, name)
    }
  }

  return { keys, candidates, dynamic }
}

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

function readCatalogue(locale) {
  const file = join(CATALOGUE_DIR, `${locale}.json`)
  if (!existsSync(file)) return null
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${rel(file)} must be a flat JSON object of string values`)
  }
  return parsed
}

/** Deterministic: codepoint order, so a regenerated file diffs cleanly. */
function renderCatalogue(entries) {
  const ordered = [...entries].sort()
  const flat = {}
  for (const key of ordered) flat[key] = key
  return JSON.stringify(flat, null, 2) + '\n'
}

const firstLocation = (keys, key) => (keys.has(key) ? keys.get(key)[0] : null)
const show = (key) => JSON.stringify(key)

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const failures = []
/**
 * Hard in both modes. Reserved for a key vue-i18n cannot compile, which the
 * contract calls a hard error: it throws at render, so it is a defect in the
 * source rather than an unfinished catalogue.
 */
const fail = (rule, message) => failures.push({ rule, message })
/**
 * A contract rule. Reported in both modes, fatal only under `--check`,
 * because extract's job is "regenerate en.json + report" — failing it
 * because de.json is unfinished would make the first-ever extract
 * impossible, since the first extract is what creates en.json.
 */
const enforce = (rule, message) => {
  if (checkOnly) fail(rule, message)
}

function reportCandidates(all) {
  if (all.length === 0) return
  const byFile = new Map()
  for (const candidate of all) {
    if (!byFile.has(candidate.file)) byFile.set(candidate.file, [])
    byFile.get(candidate.file).push(candidate)
  }
  const perFileLimit = verbose ? Infinity : 12
  console.log(`\n  Migration candidates (${all.length} in ${byFile.size} files)`)
  console.log('  Reported only. Rule 4 fails once the waves close.\n')
  for (const [file, list] of byFile) {
    console.log(`  ${file}  (${list.length})`)
    for (const candidate of list.slice(0, perFileLimit)) {
      console.log(`    ${candidate.file}:${candidate.line}  [${candidate.kind}] ${show(candidate.value)}`)
    }
    if (list.length > perFileLimit) {
      console.log(`    … ${list.length - perFileLimit} more (--verbose)`)
    }
  }
}

function reportGaps(keys, catalogues) {
  console.log(`\n  Translation gaps`)
  for (const [locale, catalogue] of catalogues) {
    // `Object.hasOwn`, not `key in catalogue`: `in` walks the prototype
    // chain, so a key named `constructor`, `toString` or `__proto__` reads
    // as translated when the catalogue does not contain it at all. Those are
    // plausible English UI strings, and the failure is silent — the catalogue
    // is reported complete while shipping the English key untranslated.
    const missing = [...keys.keys()].filter((key) => !Object.hasOwn(catalogue, key))
    // Same predicate as rule 3, so a malformed value cannot throw here
    // before the rule gets to report it properly.
    const placeholders = Object.entries(catalogue).filter(
      ([key, value]) => typeof value !== 'string' || value.trim() === '' || value === key,
    )
    if (missing.length === 0 && placeholders.length === 0) {
      console.log(`\n  ${locale}: complete`)
      continue
    }
    console.log(`\n  ${locale} — ${missing.length} missing, ${placeholders.length} untranslated`)
    for (const key of missing) {
      const at = firstLocation(keys, key)
      console.log(`\n  ${at ? `${at.file}:${at.line}` : '(no location)'}`)
      console.log(`    ${show(key)}`)
    }
    for (const [key, value] of placeholders) {
      console.log(`\n  ${rel(join(CATALOGUE_DIR, `${locale}.json`))}`)
      console.log(`    ${show(key)} → ${describePlaceholder(value)}`)
    }
  }
}

function describePlaceholder(value) {
  if (typeof value !== 'string') return `${show(value)} is not a string`
  if (value.trim() === '') return '(empty)'
  return 'identical to English'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(
  checkOnly ? 'i18n:check' : 'i18n:extract',
  `— scanning src/**/*.{${[...SCAN_EXTENSIONS].join(',')}}`,
)

const { keys, candidates, dynamic } = scan()

console.log(`\n  ${keys.size} keys, ${candidates.length} migration candidates`)

// Rule 0 — a key vue-i18n cannot compile is a hard error in both modes.
// It fails at render (or, with the message compiler dropped, prints its own
// source), so nothing downstream of it is worth reporting.
for (const [key, locations] of keys) {
  const bad = syntaxProblem(key)
  if (bad !== null) {
    for (const { file, line } of locations) {
      fail('syntax', `${file}:${line}\n    ${show(key)}\n    unescaped ${bad.map(show).join(' ')} — vue-i18n reads these as interpolation / plural syntax`)
    }
  }
}

if (dynamic.length > 0) {
  console.log(`\n  Dynamic keys (${dynamic.length}) — not harvestable, check they are intentional:`)
  for (const { file, line } of dynamic) console.log(`    ${file}:${line}`)
}

const generated = renderCatalogue(keys.keys())
const enFile = join(CATALOGUE_DIR, `${SOURCE_LOCALE}.json`)
const onDisk = existsSync(enFile) ? readFileSync(enFile, 'utf8') : null

const catalogues = new Map()
for (const locale of TARGET_LOCALES) {
  const catalogue = readCatalogue(locale)
  if (catalogue === null) {
    enforce('missing-catalogue', `${rel(join(CATALOGUE_DIR, `${locale}.json`))} does not exist`)
  } else {
    catalogues.set(locale, catalogue)
  }
}

// Rule 1 — en.json drift. Compared as text, not as a parsed object, so
// reordering and reformatting are drift too.
if (onDisk !== generated) {
  const message =
    onDisk === null
      ? `${rel(enFile)} does not exist`
      : `${rel(enFile)} is out of date with the source`
  enforce('drift', `${message} — ${keys.size} keys harvested, run: npm run i18n:extract`)
}

// Rule 2 — en \ <lang>, plus the reverse. The reverse matters: it is the
// whole enforcement mechanism, because the key IS the English literal, so a
// copy edit orphans the translation it was paired with.
for (const [locale, catalogue] of catalogues) {
  for (const key of keys.keys()) {
    // See the note in reportGaps — `in` would treat an inherited property
    // name as a present translation.
    if (!Object.hasOwn(catalogue, key)) {
      const at = firstLocation(keys, key)
      enforce('missing', `${locale} is missing a translation\n\n  ${at ? `${at.file}:${at.line}` : '(no location)'}\n    ${show(key)}`)
    }
  }
  for (const key of Object.keys(catalogue)) {
    if (!keys.has(key)) {
      enforce(
        'orphan',
        `${locale} has a key the source no longer contains — the English text was edited\n\n  ${rel(join(CATALOGUE_DIR, `${locale}.json`))}\n    ${show(key)}`,
      )
    }
  }
}

// Rule 3 — an empty or English-identical value is an untranslated
// placeholder that reads as translated until a German user hits it.
for (const [locale, catalogue] of catalogues) {
  for (const [key, value] of Object.entries(catalogue)) {
    if (typeof value !== 'string' || value.trim() === '') {
      enforce('placeholder', `${locale} has an empty translation\n\n  ${rel(join(CATALOGUE_DIR, `${locale}.json`))}\n    ${show(key)}`)
    } else if (value === key) {
      enforce('placeholder', `${locale} has an English-identical value — untranslated placeholder\n\n  ${rel(join(CATALOGUE_DIR, `${locale}.json`))}\n    ${show(key)}`)
    }
    const bad = syntaxProblem(String(value))
    if (bad !== null) {
      fail(
        'syntax',
        `${locale} value has unescaped ${bad.map(show).join(' ')}\n\n  ${rel(join(CATALOGUE_DIR, `${locale}.json`))}\n    ${show(key)} → ${show(String(value))}`,
      )
    }
  }
}

// Rule 4 — raw text outside $t(). A failure from here on: the migration is
// closed, so a literal the operator reads is a string the catalogue does not
// carry. Reported in both modes, and enforced under `--check`.
reportCandidates(candidates)
for (const candidate of candidates) {
  enforce(
    'raw-text',
    `${candidate.file}:${candidate.line}\n    ${show(candidate.value)}\n    raw text outside t() — wrap it in t()`,
  )
}

// Writing happens even when the translations are incomplete: en.json is the
// *generated* half of the contract and is never hand-edited, so regenerating
// it must not be gated on the hand-edited half being finished.
if (!checkOnly) {
  writeFileSync(enFile, generated)
  console.log(`\n  wrote ${rel(enFile)} (${keys.size} keys)`)
}

if (failures.length === 0) {
  reportGaps(keys, catalogues)
  console.log(`\n  ok — ${keys.size} keys, ${catalogues.size} catalogue(s) complete`)
  process.exit(0)
}

console.error(`\n  ${failures.length} problem(s)\n`)
for (const { rule, message } of failures) {
  console.error(`  [${rule}]\n  ${message}\n`)
}
if (!checkOnly) {
  console.error('  extract reports but does not enforce; the same problems fail under: npm run i18n:check')
}
process.exit(1)