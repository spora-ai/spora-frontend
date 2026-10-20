/**
 * The extractor's template-literal rule, proven in both directions.
 *
 * The rule extends rule 4 to template literals: operator copy that lives
 * in one has to be reported, and the template literals that are
 * everywhere else — DOM ids, API paths, CSS values, class names,
 * markup, log lines, diagnostics — have to stay silent. Reporting those
 * would flood the gate with hundreds of false positives.
 *
 * The proof runs against the fixture tree, not the real `src/`: the real
 * tree is clean, so a passing run over it proves nothing. The script's
 * own `--root` flag exists for exactly this.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'i18n-extractor')
const SCRIPT = join(REPO_ROOT, 'scripts', 'i18n.mjs')

let workdir: string

/** Run the extractor against a tree and return its stdout. */
function extract(root: string): string {
  return execFileSync('node', [SCRIPT, '--root', root], { cwd: REPO_ROOT, encoding: 'utf8' })
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'i18n-extractor-'))
  cpSync(join(FIXTURE, 'src'), join(workdir, 'src'), { recursive: true })
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('the template-literal rule', () => {
  it('reports operator copy that lives in a template literal', () => {
    const output = extract(workdir)

    expect(output).toContain('Remove from this group? They will lose access to every agent in it.')
    expect(output).toContain('scheduled runs')
  })

  it('stays quiet about the template literals that are not copy', () => {
    const output = extract(workdir)

    // DOM id, API path, CSS value, class name, markup, log line,
    // diagnostic and `??` fallback.
    expect(output).not.toContain('agent_row_')
    expect(output).not.toContain('/agents/')
    expect(output).not.toContain('px')
    expect(output).not.toContain('card-')
    expect(output).not.toContain('<div class=')
    expect(output).not.toContain('[worker] task')
    expect(output).not.toContain('Invalid plugin slug:')
    expect(output).not.toContain('Unreadable response from')
  })

  it('fails the check on the operator copy and on nothing else', () => {
    // The extract run above wrote the fixture's en.json, so the check
    // only sees the template-literal rule.
    extract(workdir)

    let failed = false
    let output = ''
    try {
      output = execFileSync('node', [SCRIPT, '--root', workdir, '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? ''
      output = `${(error as { stdout?: string }).stdout ?? ''}${stderr}`
      failed = true
    }

    expect(failed).toBe(true)
    expect(output).toContain('Remove from this group? They will lose access to every agent in it.')
    expect(output).not.toContain('agent_row_')
    expect(output).not.toContain('[worker] task')
  })

  it('leaves the real source tree alone once the wave is closed', () => {
    // The fixture proves the rule is loud; the real tree proves it is
    // quiet where it matters. Scanning the whole tree takes a few
    // seconds, so this one gets its own timeout.
    const output = execFileSync('node', [SCRIPT, '--root', REPO_ROOT, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(output).toContain('0 migration candidates')
  }, 60_000)
})

describe('the fixture tree', () => {
  it('is a tree the extractor can scan', () => {
    const source = readFileSync(join(FIXTURE, 'src', 'template-literals.ts'), 'utf8')
    expect(source).toContain('Remove ${name} from this group?')
  })
})
