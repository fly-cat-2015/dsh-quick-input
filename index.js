/**
 * Host half of the Quick Input bundle.
 *
 * It owns the quick-input document and serves it to the browser half over one
 * same-origin route registered on the composed WebServer:
 *
 *   GET    /dsh-quick-input/items  -> { items: Item[] | null, path }
 *   PUT    /dsh-quick-input/items  -> { items: Item[],      path }   body: { items: Item[] }
 *   DELETE /dsh-quick-input/items  -> { items: null,        path }   (restore built-in defaults)
 *
 * `items: null` means "no stored document yet": the browser half then seeds its
 * built-in defaults and persists them. The document lives at
 * `<DSH home>/quick-input/items.json`, so it survives restarts and is shared by
 * every browser pointed at this Harness.
 *
 * Rendering is entirely the Client half's job; this half only reads and writes
 * the file, and sanitizes whatever the browser sends.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Plugin row id (matches cordis.patch.yml). */
export const name = 'quick-input'
/** Services this plugin needs: the browser HTTP carrier for its data route. */
export const inject = ['webServer']

const ROUTE_ITEMS = '/dsh-quick-input/items'
const DATA_DIR_NAME = 'quick-input'
const DATA_FILE_NAME = 'items.json'
const MAX_ITEMS = 200
const MAX_LABEL = 100
const MAX_CONTENT = 20000

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
 * The data route: one method switch over the quick-input document.
 * @param req - incoming request
 * @param res - response to own
 * @param file - absolute document path
 * @param dir - document directory
 */
async function handleItems(req, res, file, dir) {
  const method = (req.method || 'GET').toUpperCase()

  if (method === 'GET') {
    sendJson(res, 200, { items: await readItems(file), path: file })
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
    sendJson(res, 200, { items, path: file })
    return
  }

  if (method === 'DELETE') {
    try {
      await rm(file, { force: true })
    } catch {
      /* absent counts as success */
    }
    sendJson(res, 200, { items: null, path: file })
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