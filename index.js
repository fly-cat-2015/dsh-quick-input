/**
 * Host half of the Quick Input bundle.
 *
 * It owns the quick-input document and serves it to the browser half over one
 * same-origin route registered on the composed WebServer:
 *
 *   GET    /dsh-quick-input/items  -> { items, defaults, dictionaries, path }
 *   PUT    /dsh-quick-input/items  -> { items, defaults, dictionaries, path }   body: { items: Item[] }
 *   DELETE /dsh-quick-input/items  -> { items: null, defaults, dictionaries, path }   (restore built-in defaults)
 *
 * `items: Item[]` is the stored list and `null` means "no stored document yet",
 * in which case the browser half seeds `defaults` and persists them. `defaults`
 * and `dictionaries` always carry the shipped seed list and UI text, so the
 * browser half keeps no entry or wording of its own. The document lives at
 * `<DSH home>/quick-input/items.json`, so it survives restarts and is shared by
 * every browser pointed at this Harness.
 *
 * Both pieces of authored content are files beside this one, not literals in
 * it — changing text never means editing code:
 *   content/defaults.json  built-in seed entries (plain text, not translated)
 *   locale/<lang>.json     `meta` = plugin-card title/description, `quickInput`
 *                         = the UI dictionary that file's language publishes
 *
 * The seed list deliberately does NOT live in `locale/`: `dsh-app-boot` scans
 * that directory for plugin-card metadata and accepts any 2–8 letter filename
 * stem as a language id, so a data file there is read as a language file.
 *
 * The dictionaries travel over this same route because that is the only channel
 * a third-party client bundle owns: the browser module loader serves plugin
 * resources as JavaScript chunks only, so `locale/*.json` cannot be fetched
 * from the page. Rendering is entirely the Client half's job; this half reads
 * the files, sanitizes whatever the browser sends, and writes the document.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin row id (matches cordis.patch.yml). */
export const name = 'quick-input'
/** Services this plugin needs: the browser HTTP carrier for its data route. */
export const inject = ['webServer']

const ROUTE_ITEMS = '/dsh-quick-input/items'
const DATA_DIR_NAME = 'quick-input'
const DATA_FILE_NAME = 'items.json'
/** Authored content, resolved relative to this module — never to the CWD. */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_FILE = join(PACKAGE_DIR, 'content', 'defaults.json')
const CONTENT_DIR = join(PACKAGE_DIR, 'locale')
/** Language-file naming and content limits. */
const LANGUAGE_FILE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/
const MAX_ITEMS = 200
const MAX_LABEL = 100
const MAX_CONTENT = 20000
const MAX_LOCALE_TEXT = 4000
const MAX_LOCALE_KEYS = 400

/** One stored quick-input candidate. */
// { id: string, label: string, content: string }

/**
 * Resolve the Harness home with the same precedence
 * `@deepseek-ai/dsh-home-paths` documents: a non-empty `$DSH_HOME` wins,
 * otherwise `~/.dsh`. Kept dependency-free on purpose, so the bundle resolves
 * whatever directory it is installed from.
 * @returns absolute harness home path
 */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) {
    const value = configured.trim()
    if (value === '~') return homedir()
    if (value.startsWith('~/') || value.startsWith('~\\')) return resolve(join(homedir(), value.slice(2)))
    return resolve(value)
  }
  return resolve(join(homedir(), '.dsh'))
}

let idSeq = 0
/** Mint a stable id for an entry the browser sent without one. */
function makeId() {
  idSeq += 1
  return 'qi-' + Date.now().toString(36) + '-' + idSeq.toString(36)
}

/** Human-readable message of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Accept only what the contract allows, so a malformed browser payload can
 * never corrupt the document: drop entries without content, clamp text
 * lengths, cap the entry count, and de-duplicate ids.
 * @param input - the raw `items` value from the request body
 * @returns the sanitized list, or null when `input` is not an array
 */
function sanitizeItems(input) {
  if (!Array.isArray(input)) return null
  const out = []
  const seen = new Set()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const content = typeof raw.content === 'string' ? raw.content : ''
    if (content.trim().length === 0) continue
    const label = (typeof raw.label === 'string' ? raw.label : '').trim().slice(0, MAX_LABEL)
    let id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id.length === 0 || seen.has(id)) id = makeId()
    seen.add(id)
    out.push({ id, label, content: content.slice(0, MAX_CONTENT) })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/**
 * Read the shipped seed list.
 *
 * A malformed or unreadable defaults file yields an empty list rather than
 * failing the route: the popup then simply starts empty and the user adds
 * entries by hand, which is better than a plugin that cannot load at all.
 * @returns the sanitized seed entries, possibly empty
 */
async function readDefaults() {
  let raw
  try {
    raw = await readFile(DEFAULTS_FILE, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    const items = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.items : parsed
    return sanitizeItems(items) ?? []
  } catch {
    return []
  }
}

/** Keep only a flat dictionary of short string values. */
function sanitizeDictionary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string' || text.length === 0) continue
    out[key] = text.slice(0, MAX_LOCALE_TEXT)
    if (Object.keys(out).length >= MAX_LOCALE_KEYS) break
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Read every `locale/<language>.json`, once per Harness run.
 *
 * Keys of the returned map are the lowercase language ids, matching the
 * filename; a file that is not a regular language file, holds no usable
 * `quickInput` object, or duplicates an id is ignored rather than breaking
 * the route. The browser half decides which language to publish where.
 * The in-flight promise is kept, so concurrent requests share one directory
 * read and the cached result is never a half-built object.
 * @returns language id to sanitized `quickInput` dictionary
 */
function readDictionaries() {
  if (dictionariesPromise === undefined) dictionariesPromise = loadDictionaries()
  return dictionariesPromise
}

/** The one directory read per run; reset never, so edits need a restart. */
let dictionariesPromise

/** Read the language files; a missing directory simply yields no dictionaries. */
async function loadDictionaries() {
  const out = {}
  let entries
  try {
    entries = await readdir(CONTENT_DIR, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isFile() || !LANGUAGE_FILE.test(entry.name)) continue
    const id = entry.name.slice(0, -5).toLowerCase()
    if (Object.prototype.hasOwnProperty.call(out, id)) continue
    let parsed
    try {
      parsed = JSON.parse(await readFile(join(CONTENT_DIR, entry.name), 'utf8'))
    } catch {
      continue // unreadable or malformed: leave this language to the shared fallback
    }
    const dictionary = sanitizeDictionary(parsed && typeof parsed === 'object' ? parsed.quickInput : undefined)
    if (dictionary !== undefined) out[id] = dictionary
  }
  return out
}

/**
 * Read the stored document.
 * @param file - absolute document path
 * @returns the stored entries, or null when the file is absent or unreadable
 */
async function readItems(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null // absent: the browser half seeds the defaults
  }
  try {
    const parsed = JSON.parse(raw)
    const items = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.items : parsed
    return sanitizeItems(items) ?? null
  } catch {
    return null // corrupt: report absence rather than overwrite silently on read
  }
}

/**
 * Write the document through a temporary file, so an interrupted write cannot
 * leave a half-written document behind.
 * @param file - absolute document path
 * @param dir - directory to create when missing
 * @param items - sanitized entries
 */
async function writeItems(file, dir, items) {
  await mkdir(dir, { recursive: true })
  const document = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items }, null, 2)
  const temporary = file + '.tmp'
  await writeFile(temporary, document, 'utf8')
  await rename(temporary, file)
}

/** Read the whole request body as UTF-8 text. */
function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Answer with JSON. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * The data route: one method switch over the quick-input document. Every
 * answer carries the shipped seed list, the language dictionaries and the
 * document path, so one GET gives the browser half everything it renders with.
 * @param req - incoming request
 * @param res - response to own
 * @param file - absolute document path
 * @param dir - document directory
 */
async function handleItems(req, res, file, dir) {
  const method = (req.method || 'GET').toUpperCase()
  const [defaults, dictionaries] = await Promise.all([readDefaults(), readDictionaries()])

  if (method === 'GET') {
    sendJson(res, 200, { items: await readItems(file), defaults, dictionaries, path: file })
    return
  }

  if (method === 'PUT' || method === 'POST') {
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    const items = sanitizeItems(parsed && typeof parsed === 'object' ? parsed.items : undefined)
    if (!items) {
      sendJson(res, 400, { error: 'body must be { items: [...] }' })
      return
    }
    try {
      await writeItems(file, dir, items)
    } catch (error) {
      sendJson(res, 500, { error: messageOf(error) })
      return
    }
    sendJson(res, 200, { items, defaults, dictionaries, path: file })
    return
  }

  if (method === 'DELETE') {
    try {
      await rm(file, { force: true })
    } catch {
      /* absent counts as success */
    }
    sendJson(res, 200, { items: null, defaults, dictionaries, path: file })
    return
  }

  sendJson(res, 405, { error: 'method not allowed' })
}

/**
 * Mount the data route.
 * @param ctx - the plugin's Host context
 */
export function apply(ctx) {
  const dir = join(dshHome(), DATA_DIR_NAME)
  const file = join(dir, DATA_FILE_NAME)
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_ITEMS,
      handler: (req, res) => {
        handleItems(req, res, file, dir).catch((error) => {
          try {
            sendJson(res, 500, { error: messageOf(error) })
          } catch {
            /* response already gone */
          }
        })
      },
    }),
  )
}