import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '../..')

/**
 * Allowlists for the two route parameters that are turned into module paths and
 * handed to a dynamic `import()`.
 *
 * These exist because Express decodes percent-escapes in a captured route param
 * *after* matching it. `:engine` will not match a literal `/`, but it happily
 * matches `..%2f..%2ftmp`, which `decode_param` then turns into `../../tmp`
 * before the handler sees it. Any check of the form
 * `existsSync(join(cwd, 'engines', param, 'engine.js'))` therefore validates a
 * path the caller steered, and approves importing — and executing — any
 * `engine.js` reachable on the filesystem.
 *
 * Comparing the raw parameter against a set of known directory names removes the
 * traversal entirely: a name containing a separator or a dot segment is simply
 * not in the set. Nothing is concatenated until after the name is known-good.
 *
 * Snapshotted once at module load. Engines and eval categories are directories
 * shipped with the deployment; they do not appear at runtime, and re-reading the
 * filesystem on every request would put I/O on the hot path for a set that never
 * changes. Adding one requires a restart, which is already true of the code that
 * would import it.
 *
 * Note this deliberately does NOT filter `test-` engines: they are reachable via
 * /generate today and `config.includeTestEngines` only governs whether they are
 * *listed*. Keeping that behaviour makes this purely a security fix.
 */

function directoryNames(relativePath) {
  const absolute = path.join(APP_ROOT, relativePath)
  try {
    return new Set(
      fs.readdirSync(absolute, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    )
  } catch {
    return new Set()
  }
}

function moduleNames(relativePath) {
  const absolute = path.join(APP_ROOT, relativePath)
  try {
    return new Set(
      fs.readdirSync(absolute, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
        .map(entry => entry.name.slice(0, -'.js'.length))
    )
  } catch {
    return new Set()
  }
}

let _engineNames = null
let _evalCategoryNames = null

/** Directory names under engines/ that a request is allowed to name. */
export function engineNames() {
  return _engineNames ??= directoryNames('engines')
}

/** Module names under evals/categories/ that a request is allowed to name. */
export function evalCategoryNames() {
  return _evalCategoryNames ??= moduleNames('evals/categories')
}
