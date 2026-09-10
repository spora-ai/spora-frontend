/**
 * Centralized highlight.js setup.
 *
 * The full `highlight.js` package eagerly imports ~190 language definitions
 * via its barrel file, which the bundler splits into one chunk per language
 * (totalling ~1.1 MB of preloaded JS for code paths the app never visits).
 * This module instead pulls in `highlight.js/lib/core` plus a curated set of
 * languages that the three call sites (`useMarkdown`, `ToolArgumentsEditor`,
 * `ToolArgumentsPreview`) actually need, so the bundler only emits chunks for
 * the languages we register.
 *
 * Curated language set covers the common fenced-block outputs the LLM emits
 * in chat (json, js/ts, python, bash, yaml, sql, go, rust, java, c-family,
 * css, html, markdown, php, ruby) plus the language-agnostic fallbacks the
 * Markdown renderer needs (`useMarkdown.ts` passes `lang` through to
 * `hljs.highlight` and falls back to no highlighting when the language is
 * unknown).
 *
 * The `json` registration is mandatory — `ToolArgumentsEditor` and
 * `ToolArgumentsPreview` always render tool-argument JSON.
 */
import hljs from 'highlight.js/lib/core'

import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const REGISTRATIONS: ReadonlyArray<[string, unknown]> = [
  ['bash', bash],
  ['c', c],
  ['cpp', cpp],
  ['csharp', csharp],
  ['css', css],
  ['go', go],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['markdown', markdown],
  ['php', php],
  ['python', python],
  ['ruby', ruby],
  ['rust', rust],
  ['sql', sql],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
]

// Some fenced-block languages use aliases (`sh` → `bash`, `py` → `python`,
// `yml` → `yaml`, `ts` → `typescript`, `js` → `javascript`, `html` → `xml`).
// The LLM and existing markdown content mix these freely; wire them up so
// `hljs.getLanguage(lang)` returns truthy for both the canonical name and
// its common aliases.
const ALIASES: ReadonlyArray<[string, string]> = [
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['c++', 'cpp'],
  ['cc', 'cpp'],
  ['h++', 'cpp'],
  ['hpp', 'cpp'],
  ['hh', 'cpp'],
  ['hxx', 'cpp'],
  ['cxx', 'cpp'],
  ['cs', 'csharp'],
  ['py', 'python'],
  ['py3', 'python'],
  ['yml', 'yaml'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['html', 'xml'],
  ['htm', 'xml'],
]

let installed = false

/**
 * Idempotent install. Called eagerly by each consumer (or by importing
 * this module) so we don't have to expose a separate "boot the languages"
 * step in app entrypoints.
 */
export function installHighlightLanguages(): typeof hljs {
  if (installed) return hljs
  for (const [name, language] of REGISTRATIONS) {
    hljs.registerLanguage(name, language as Parameters<typeof hljs.registerLanguage>[1])
  }
  for (const [alias, target] of ALIASES) {
    hljs.registerAliases(alias, { languageName: target })
  }
  installed = true
  return hljs
}

// Install on module load so consumers don't need to remember to call the
// helper. Safe because the function is idempotent.
export default installHighlightLanguages()
