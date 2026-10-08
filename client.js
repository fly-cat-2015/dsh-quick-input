/**
 * Client half of the Quick Input bundle.
 *
 * Two seats, one document:
 *   1. `conversation.input.dock` — the 【快捷输入】 button above the composer and
 *      its candidate popup, opened UPWARD (the popup is portaled to the body and
 *      positioned against the button's viewport rectangle, because the composer
 *      card paints above the dock row's stacking context). Picking a candidate
 *      inserts it into the composer.
 *   2. `settings.section` — the settings page that maintains the candidates
 *      (add / edit / delete / search).
 *
 * The document itself is owned by the Host half at
 * `<DSH home>/quick-input/items.json`, reached through the same-origin route
 * `/dsh-quick-input/items`. This file holds the shared store both seats read,
 * so a change made in Settings is visible to the composer popup at once.
 *
 * No user-facing text and no built-in entry is written here: the route also
 * serves `dictionaries` (locale/en.json, locale/zh.json, …) and `defaults`
 * (content/defaults.json), and this half only publishes what it received. A
 * missing or unreachable route therefore degrades to key names and an empty
 * list rather than to any hard-coded copy — see `rememberContent`.
 *
 * Plain JavaScript on purpose: React comes from the browser module table, the
 * plugin imports no Harness Client package, and styles use only `--dsw-alias-*`
 * tokens.
 */
window.__ModuleLoader__.load({
  id: '@fly-cat-2015/dsh-quick-input',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React
    /** Portal helper; absent when the shell's module table has no react-dom. */
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (ReactDOM && typeof ReactDOM.createPortal === 'function') createPortal = ReactDOM.createPortal
    } catch {
      /* no react-dom here: the chip simply stays in the dock row */
    }

    /** Locale namespace of this plugin's own UI text. */
    const NS = 'quick-input'
    /** Host route owning the quick-input document, its seeds and its dictionaries. */
    const ROUTE = '/dsh-quick-input/items'
    /** Gap between the button and the popup it opens above. */
    const POPUP_GAP = 6
    /** Popup width cap, floor for a very narrow window, and viewport clearance. */
    const POPUP_WIDTH = 440
    const POPUP_MIN_WIDTH = 180
    const POPUP_MARGIN = 8
    const POPUP_MIN_HEIGHT = 120
    /** Least usable height above the button before the popup flips downward. */
    const POPUP_MIN_ABOVE = 160
    /** Cold-start GET attempts, and the pause between them (linear backoff). */
    const LOAD_ATTEMPTS = 3
    const LOAD_RETRY_MS = 400

    /**
     * The shipped content the Host serves. Both are replaced as soon as the
     * route answers; until then the UI shows key names and no entries.
     */
    let dictionaries = {}
    let defaultItems = []
    /** Locale service and the ids already published, set by apply(). */
    let localeService = null
    const registered = new Set()
    /** Disposers of this instance's locale registrations, released on unload. */
    const dictionaryDisposers = []

    /** Whether a language id belongs to a Chinese dictionary. */
    function isChinese(id) {
      return /^zh/i.test(String(id))
    }

    /** Copy the Host's dictionaries into a lookup: language id -> flat text map. */
    function rememberDictionaries(source) {
      if (!source || typeof source !== 'object') return
      for (const [id, dictionary] of Object.entries(source)) {
        if (typeof id === 'string' && id.length > 0 && dictionary && typeof dictionary === 'object') dictionaries[id] = dictionary
      }
    }

    /**
     * The dictionary to publish for one language id.
     *
     * An exact file always wins, so adding `locale/ja.json` really gives Japanese
     * to `ja`. Only an id with no file of its own borrows another language's
     * text, and then by the direction the locale chain falls back in: a Chinese
     * id borrows `zh`, everything else borrows `en`. Registering English text
     * under `ja` would make a missing translation look like a present one.
     * @param id - language id
     * @returns the dictionary to register, or undefined when none was shipped
     */
    function dictionaryFor(id) {
      const key = String(id).toLowerCase()
      if (dictionaries[key]) return dictionaries[key]
      return isChinese(id) ? dictionaries.zh ?? dictionaries.en : dictionaries.en ?? dictionaries.zh
    }

    /** Register one shipped dictionary for one language id, if it has not been. */
    function registerDictionary(register, id, done) {
      if (typeof id !== 'string' || id.length === 0 || done.has(id)) return
      const dictionary = dictionaryFor(id)
      if (!dictionary || Object.keys(dictionary).length === 0) return
      try {
        const dispose = register(id, dictionary)
        // Remember only what we actually own: publishDictionaries() must be able
        // to hand every registration back when the plugin unloads, or a reload
        // would leave this namespace half-owned by a dead instance.
        if (typeof dispose === 'function') dictionaryDisposers.push(dispose)
        done.add(id)
      } catch {
        /* an id the registry refuses is simply left to the shared fallback */
      }
    }

    /** The seed entries the Host shipped, copied so callers cannot mutate them. */
    function seedItems() {
      return defaultItems.map((item) => ({ id: item.id, label: item.label, content: item.content }))
    }

    /** Publish every shipped dictionary that has not been published yet. */
    function publishDictionaries() {
      if (!localeService) return
      const register = (id, dictionary) => {
        localeService.register(NS, id, dictionary)
      }
      for (const id of Object.keys(dictionaries)) registerDictionary(register, id, registered)
      try {
        registerDictionary(register, localeService.getLocale().active, registered)
      } catch {
        /* locale service unavailable: keep what is registered */
      }
    }

    /** Every class is prefixed; only `--dsw-alias-*` tokens carry color. */
    const CSS = [
      // Dock row geometry, copied from the host's own dock entries
      // (`._7yHdaG_dock` in ui-conversation): the row centers itself on the
      // composer card so its content lands on the card's left edge. A bare
      // entry is a direct child of the composer stack and hugs the column edge.
      '.dsh-qi-dock{box-sizing:border-box;display:flex;align-items:center;flex:none;margin:0 auto;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,100%) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));padding:0 var(--dsh-composer-dock-inset,8px)}',
      // The hidden probe stays in the dock row while the chip is portaled into
      // the hero row, so the row stays discoverable and the layout loses nothing.
      '.dsh-qi-probe{display:none}',
      '.dsh-qi-anchor{position:relative;display:inline-flex;align-items:center}',
      '.dsh-qi-trigger{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:3px 10px;font-size:12px;line-height:18px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:background-color .12s ease,color .12s ease,border-color .12s ease}',
      '.dsh-qi-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-qi-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.dsh-qi-trigger-icon{font-size:12px;line-height:1}',
      // Hero chip row recipe (transparent 28px pill, label-primary ink,
      // interactive-bg hover/open), matching the official WorkspaceChip /
      // AgentPresetSeat pills that share that row.
      '.dsh-qi-trigger.dsh-qi-trigger-hero{height:auto;min-height:28px;max-width:min(100%,240px);padding:0 8px;border:none;border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);gap:4px;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}',
      '.dsh-qi-trigger.dsh-qi-trigger-hero:hover,.dsh-qi-trigger.dsh-qi-trigger-hero[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // The popup is portaled to the body: the dock row is painted under the
      // composer card (`z-index: 7` on the seat), so a popup nested in that row
      // is covered by the input box. `fixed` + inline coordinates put it above
      // the button in both seats, and it ALWAYS opens upward.
      '.dsh-qi-popup{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 30px rgba(0,0,0,.28);overflow:hidden}',
      '.dsh-qi-search{box-sizing:border-box;width:100%;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:5px 10px;font-size:13px;font-family:inherit;outline:none}',
      // `flex:1;min-height:0` lets the list absorb whatever height the panel has
      // left (its maxHeight is inline), so a short viewport scrolls the list
      // instead of pushing rows out through the panel border.
      '.dsh-qi-list{flex:1 1 auto;min-height:0;max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}',
      '.dsh-qi-row{display:flex;flex-direction:column;gap:2px;align-items:flex-start;width:100%;box-sizing:border-box;text-align:left;border:0;background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font-family:inherit;cursor:pointer}',
      '.dsh-qi-row:hover,.dsh-qi-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-qi-row-label{font-size:13px;font-weight:500}',
      '.dsh-qi-row-content{max-width:100%;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-qi-empty{padding:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-qi-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-qi-section{max-width:720px;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary)}',
      '.dsh-qi-h2{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.dsh-qi-p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-qi-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}',
      '.dsh-qi-card-title{font-size:13px;font-weight:500}',
      '.dsh-qi-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-qi-input,.dsh-qi-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:5px 10px;font-size:13px;font-family:inherit;outline:none}',
      '.dsh-qi-textarea{min-height:64px;resize:vertical;line-height:20px}',
      '.dsh-qi-input:focus,.dsh-qi-textarea:focus,.dsh-qi-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-qi-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-qi-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 14px;font-size:12px;font-family:inherit;cursor:pointer}',
      '.dsh-qi-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-qi-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.dsh-qi-btn-primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff}',
      '.dsh-qi-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-qi-btn-danger[data-confirm="true"]{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.dsh-qi-item{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}',
      '.dsh-qi-item-main{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}',
      '.dsh-qi-item-label{font-size:13px;font-weight:500;word-break:break-word}',
      '.dsh-qi-item-content{max-height:72px;overflow:hidden;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.dsh-qi-item-actions{display:flex;gap:6px;flex-shrink:0}',
      '.dsh-qi-listhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
      '.dsh-qi-status{font-size:12px;line-height:18px}',
      '.dsh-qi-status-ok{color:var(--dsw-alias-state-success-primary)}',
      '.dsh-qi-status-err{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-qi-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}',
    ].join('\n')

    // ------------------------------------------------------------------
    // Shared store. One module instance per page, so the composer popup and
    // the settings page always read the same list.
    // ------------------------------------------------------------------
    const listeners = new Set()
    let items = null
    let loaded = false
    let loading = false
    let saving = false
    /** '' | 'load' | 'save' — translated by whichever seat renders it. */
    let errorKind = ''
    let filePath = ''
    let seeded = false

    function emit() {
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch {
          /* one broken listener must not stop the others */
        }
      }
    }

    function getState() {
      return { items, loaded, loading, saving, errorKind, filePath }
    }

    function subscribeStore(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function useStore() {
      const [state, setState] = useState(getState)
      useEffect(() => subscribeStore(() => setState(getState())), [])
      return state
    }

    async function request(method, body) {
      const response = await fetch(ROUTE, {
        method,
        headers:
          body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return await response.json()
    }

    /**
     * Read once (or force a re-read) from the host document. The same answer
     * carries the shipped dictionaries and seeds; both are adopted only when
     * they actually arrived, so a route that is unreachable cannot wipe the
     * content an earlier successful read already installed.
     *
     * This is also where the UI text comes from, so it is retried a few times on
     * a cold start: the first call races the web server's route registration,
     * and a lost race would otherwise leave every label showing its raw key
     * until the user happened to open a seat.
     */
    async function load(force) {
      if (loading) return
      if (loaded && !force) return
      loading = true
      emit()
      try {
        let data
        for (let attempt = 0; ; attempt += 1) {
          try {
            data = await request('GET')
            break
          } catch (error) {
            if (dictionariesLoaded() || attempt >= LOAD_ATTEMPTS - 1) throw error
            await delay(LOAD_RETRY_MS * (attempt + 1))
          }
        }
        rememberContent(data)
        if (data && Array.isArray(data.items)) {
          items = data.items
          seeded = true
        } else if (!seeded) {
          items = seedItems()
          seeded = true
          void persist(items) // first run: materialize the seeds so Settings lists real rows
        }
        if (data && typeof data.path === 'string') filePath = data.path
        errorKind = ''
      } catch {
        if (!seeded) {
          items = seedItems()
          seeded = true
        }
        errorKind = 'load'
      } finally {
        loading = false
        loaded = true
        emit()
      }
    }

    /** Whether any shipped dictionary has been registered in this page. */
    function dictionariesLoaded() {
      return registered.size > 0
    }

    /** Wait, for the cold-start retry above. */
    function delay(ms) {
      return new Promise((resolvePromise) => {
        setTimeout(resolvePromise, ms)
      })
    }

    /**
     * Adopt the content the Host shipped with one route answer: its UI
     * dictionaries (published into the locale service, so `locale/<lang>.json`
     * wording is what the user sees) and its built-in seeds (content/defaults.json).
     * @param data - the parsed route body
     */
    function rememberContent(data) {
      if (!data || typeof data !== 'object') return
      rememberDictionaries(data.dictionaries)
      if (Array.isArray(data.defaults)) defaultItems = data.defaults
      publishDictionaries()
    }

    /**
     * Apply a new list optimistically, then write it through the host route.
     * The seed list may arrive with the very same answer, so it is adopted here
     * too — `restore defaults` right after a first load then restores the real
     * shipped list rather than an empty one.
     */
    async function persist(next) {
      items = next
      saving = true
      emit()
      try {
        const data = await request('PUT', { items: next })
        rememberContent(data)
        if (data && Array.isArray(data.items)) items = data.items
        errorKind = ''
      } catch {
        errorKind = 'save' // keep the in-memory list so the edit is not lost
      } finally {
        saving = false
        emit()
      }
    }

    function nextId() {
      return 'qi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    function addItem(label, content) {
      void persist([...(items || []), { id: nextId(), label: String(label || '').trim(), content }])
    }

    function updateItem(id, patch) {
      void persist((items || []).map((item) => (item.id === id ? Object.assign({}, item, patch) : item)))
    }

    function removeItem(id) {
      void persist((items || []).filter((item) => item.id !== id))
    }
    // ------------------------------------------------------------------

    /** Re-render on locale switches: `t` reads the active locale at call time. */
    function useLocaleRevision(locale) {
      const [revision, setRevision] = useState(0)
      useEffect(() => locale.subscribe(() => setRevision((value) => value + 1)), [])
      return revision
    }

    function filterItems(list, query) {
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return list
      return list.filter((item) => (item.label + '\n' + item.content).toLowerCase().includes(needle))
    }

    /** One-line preview of an entry's content. */
    function preview(content) {
      const text = String(content || '').replace(/\s+/g, ' ').trim()
      return text.length > 90 ? text.slice(0, 90) + '…' : text
    }

    /**
     * Whether a node is the official blank-session hero chip row. The row is
     * `heroWorkspaceRow` in ui-conversation and carries the workspace / preset /
     * model chips above the input card.
     */
    function isHeroChipRow(node) {
      return Boolean(node && typeof node.className === 'string' && node.className.includes('heroWorkspaceRow'))
    }

    /** Two placement results are the same box when every offset matches. */
    function sameBox(left, right) {
      if (!left || !right) return false
      return left.left === right.left && left.top === right.top && left.bottom === right.bottom
        && left.width === right.width && left.maxHeight === right.maxHeight
    }

    /** Viewport of the window the app is painted in (the visual viewport while zoomed). */
    function viewportBox() {
      const view = typeof window === 'undefined' ? undefined : window
      const visual = view && view.visualViewport ? view.visualViewport : undefined
      const width = visual ? visual.width : view ? view.innerWidth : 0
      const height = visual ? visual.height : view ? view.innerHeight : 0
      const left = visual ? visual.offsetLeft : 0
      const top = visual ? visual.offsetTop : 0
      return { left, top, width, height }
    }

    /**
     * Place the popup against the button's own viewport rectangle.
     *
     * The popup is portaled to the body and `position: fixed`, for two reasons:
     * the dock row is painted under the composer card (the seat carries
     * `z-index: 7`), so a nested popup would be covered by the input box; and a
     * `fixed` box cannot be clipped by the composer's own scroll container.
     * It opens UPWARD in both seats — the caller's requirement — and only falls
     * back to opening downward if the button sits too close to the top edge to
     * fit a usable panel above it.
     * @param anchor - the trigger button
     * @returns inline offsets, or null while the button has no box yet
     */
    function placePopup(anchor) {
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return null
      const rect = anchor.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null
      const view = viewportBox()
      const width = Math.max(POPUP_MIN_WIDTH, Math.min(POPUP_WIDTH, view.width - POPUP_MARGIN * 2))
      const left = Math.max(view.left + POPUP_MARGIN, Math.min(rect.left, view.left + view.width - width - POPUP_MARGIN))
      const above = rect.top - view.top - POPUP_GAP - POPUP_MARGIN
      if (above >= POPUP_MIN_ABOVE) return { left, bottom: view.height + view.top - rect.top + POPUP_GAP, width, maxHeight: above }
      const below = view.top + view.height - rect.bottom - POPUP_GAP - POPUP_MARGIN
      return { left, top: rect.bottom + POPUP_GAP, width, maxHeight: Math.max(POPUP_MIN_HEIGHT, below) }
    }

    /**
     * Keep {@link placePopup} applied to the popup.
     *
     * Two effects on purpose: the listeners live for as long as the seat does,
     * while the ResizeObserver can only be attached once the popup node exists —
     * and it does not exist until `open`, because the caller renders it
     * conditionally. Keying the observer on `open` is what makes the panel
     * re-measure when its own size changes (a longer list, a wrapped hint).
     * @param anchorRef - ref of the trigger button
     * @param open - whether the popup is currently rendered
     * @returns the popup ref plus the current box, or null before the first measure
     */
    function usePopupPlacement(anchorRef, open) {
      const popupRef = useRef(null)
      const [box, setBox] = useState(null)

      /** Measure the button and store the box, skipping no-op state writes. */
      const update = useCallback(() => {
        const next = placePopup(anchorRef.current)
        setBox((previous) => (sameBox(previous, next) ? previous : next))
      }, [anchorRef])

      // Re-measure on any layout shift the window reports. `capture` picks up
      // scrolling in the composer's own scroll container, not just the window.
      useLayoutEffect(() => {
        update()
        const view = typeof window === 'undefined' ? null : window.visualViewport
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        if (view) {
          view.addEventListener('resize', update)
          view.addEventListener('scroll', update)
        }
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
          if (view) {
            view.removeEventListener('resize', update)
            view.removeEventListener('scroll', update)
          }
        }
      }, [update])

      // The panel measures itself: content that grows or shrinks (search results
      // arriving, a translate switch) changes its height, and the anchor can move
      // without a window event — the blank-session hero row resolves
      // asynchronously and carries the button out of the dock row. Chained
      // through rAF so observing our own resize cannot loop.
      useLayoutEffect(() => {
        if (!open) return undefined
        update()
        const popup = popupRef.current
        if (!popup || typeof ResizeObserver === 'undefined') return undefined
        let frame = 0
        const observer = new ResizeObserver(() => {
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            update()
          })
        })
        observer.observe(popup)
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          observer.disconnect()
        }
      }, [open, update])

      return { popupRef, box }
    }

    /**
     * Resolve the hero chip row relative to this entry's own dock position.
     *
     * A blank session renders `composerStack > heroWorkspaceRow, dock, card`, so
     * the row is the previous sibling of the dock outlet (or of its parent).
     * Returns null while no hero row is mounted — an active session — and the
     * caller then keeps the chip in the dock row, which is the accepted
     * position there. The same shell gap (`conversation.input.selector.context`
     * is not declared by this shell) is why dsh-client-ui-git-graph portals its
     * branch chip into this row; the lookup below is local to our own subtree
     * and falls back to the dock row whenever the class name changes.
     */
    function findHeroChipRow(probe) {
      if (!probe || !probe.isConnected) return null
      const stack = probe.closest('[class*="composerStack"],[class*="composerHero"]')
      const usable = (node) => isHeroChipRow(node) && (!stack || stack.contains(node))
      const parent = probe.parentElement
      const candidates = [
        probe.previousElementSibling, // the entry is a direct child of the composer stack
        parent ? parent.previousElementSibling : null, // the entry sits in a slot outlet
        parent && parent.parentElement ? parent.parentElement.previousElementSibling : null,
      ]
      for (const candidate of candidates) {
        if (usable(candidate)) return candidate
      }
      const row = stack ? stack.querySelector('[class*="heroWorkspaceRow"]') : null
      return usable(row) ? row : null
    }

    /** Nav-row marker attribute: set on the settings nav row this section owns. */
    const NAV_ICON_ATTR = 'data-dsh-quick-input-nav-icon'
    /** The settings nav rows (`SettingsRoot` in dsh-client-ui-settings-general). */
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
    /** Nav glyph box: the shell renders every nav icon at 16px. */
    const NAV_ICON_SIZE = 16
    /**
     * The bolt as a standalone mask image. Painted pure black on purpose: a mask
     * reads alpha only, and the visible colour comes from `currentColor`, so the
     * glyph follows the row's normal / hover / active colours and every theme.
     */
    const NAV_ICON_MASK =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">' +
          '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>' +
          '</svg>',
      )

    /**
     * Give this section its own glyph in the settings navigation.
     *
     * `settings.section` projects only `id` / `order` / `label`, and the shell
     * picks nav glyphs from a closed id list (`account`, `models`,
     * `agent-presets`, `plugins`, `archived-sessions`) with its own gear as the
     * fallback — so every third-party section wears the gear, this one included.
     * There is no option to pass: claim our own row, matched solely by the label
     * the shell is currently projecting, and swap the gear for the bolt the
     * composer chip already uses. dshmarket and dsh-better-sidebar ship the same
     * workaround; delete this the day the slot grows an `icon` field.
     */
    function installSettingsNavIcon(ctx, resolveLabel) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = '@fly-cat-2015/dsh-quick-input'
        style.dataset.pluginCss = '@fly-cat-2015/dsh-quick-input/settings-nav-icon'
        style.textContent = [
          `[${NAV_ICON_ATTR}]>svg{display:none}`,
          `[${NAV_ICON_ATTR}]::before{content:'';flex:none;width:${NAV_ICON_SIZE}px;height:${NAV_ICON_SIZE}px;background-color:currentColor;`,
          `-webkit-mask-image:url("${NAV_ICON_MASK}");mask-image:url("${NAV_ICON_MASK}");`,
          `-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;`,
          `-webkit-mask-size:${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;mask-size:${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px}`,
        ].join('')
        document.head.appendChild(style)

        let disposed = false
        let scheduled = false
        /** Mark exactly the row whose visible text is our projected section label. */
        const sync = () => {
          scheduled = false
          if (disposed) return
          const wanted = String(resolveLabel() || '').trim()
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            const own = wanted.length > 0 && String(row.textContent || '').trim() === wanted
            if (own) row.setAttribute(NAV_ICON_ATTR, '')
            else row.removeAttribute(NAV_ICON_ATTR)
          }
        }
        // Coalesce a mutation burst into one pass, landing before the next paint
        // so the row never shows the gear first.
        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }
        sync()
        const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
        if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true })

        return () => {
          disposed = true
          if (observer) observer.disconnect()
          for (const row of document.querySelectorAll(`[${NAV_ICON_ATTR}]`)) row.removeAttribute(NAV_ICON_ATTR)
          style.remove()
        }
      }, 'quick-input: settings nav icon')
    }

    /** The composer seat: the button plus its candidate popup. */
    function makeTrigger(t, locale) {
      return function QuickInputTrigger(props) {
        useLocaleRevision(locale)
        const state = useStore()
        const list = state.items || []
        const [open, setOpen] = useState(false)
        const [query, setQuery] = useState('')
        const [active, setActive] = useState(0)
        const probeRef = useRef(null)
        const chipRef = useRef(null)
        const buttonRef = useRef(null)
        const searchRef = useRef(null)
        /** The hero chip row while a blank session renders one; null otherwise. */
        const [heroRow, setHeroRow] = useState(null)
        /** Viewport-anchored geometry while the popup is open. */
        const { popupRef, box } = usePopupPlacement(buttonRef, open)

        useEffect(() => {
          // Mount, and every time the popup opens: a failed first load leaves the
          // UI without its shipped text, and the `loaded` flag would stop every
          // later call. Re-reading on open is a second chance that needs no
          // user-visible retry button. `force` is read from the store rather than
          // closed over, so it reflects the outcome of the previous attempt.
          void load(state.errorKind === 'load')
        }, [open])

        // Blank session: join the official hero chip row instead of occupying a
        // dock row of our own. The hidden probe stays in the dock row, so the
        // row is resolved from a stable position and re-resolved whenever the
        // composer re-renders (session starts, card remounts).
        useLayoutEffect(() => {
          const update = () => {
            const found = findHeroChipRow(probeRef.current)
            setHeroRow((previous) => (previous === found ? previous : found))
          }
          update()
          const parent = probeRef.current ? probeRef.current.parentElement : null
          if (!parent || typeof MutationObserver === 'undefined') return undefined
          const observer = new MutationObserver(update)
          observer.observe(parent.parentElement || parent, { childList: true, subtree: true })
          return () => observer.disconnect()
        }, [])

        // Dismiss on any outside interaction or Escape, while open.
        useEffect(() => {
          if (!open) return undefined
          const onPointerDown = (event) => {
            const chip = chipRef.current
            const panel = popupRef.current
            // Both nodes are ours: the chip in the composer, the panel on the body.
            if (chip && chip.contains(event.target)) return
            if (panel && panel.contains(event.target)) return
            setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('mousedown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          return () => {
            document.removeEventListener('mousedown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
          }
        }, [open])

        useEffect(() => {
          if (!open) return undefined
          const node = searchRef.current
          if (node && typeof node.focus === 'function') node.focus()
          return undefined
        }, [open])

        const filtered = useMemo(() => filterItems(list, query), [list, query])
        useEffect(() => {
          setActive(0)
        }, [query, open])

        const close = () => {
          setOpen(false)
          setQuery('')
        }

        /** Fill the composer: at the caret when the editor accepts it, else the whole draft. */
        const pick = (item) => {
          const text = item && typeof item.content === 'string' ? item.content : ''
          close()
          if (text.length === 0) return
          const actions = props ? props.inputActions : undefined
          if (!actions) return
          try {
            const span = typeof actions.captureInsertion === 'function' ? actions.captureInsertion() : undefined
            if (span !== undefined && typeof actions.insertText === 'function' && actions.insertText(text, span)) return
          } catch {
            /* the editor refused the span: fall through to the whole-draft write */
          }
          try {
            actions.setDraft(text)
          } catch {
            /* no editor mounted */
          }
        }

        const onSearchKeyDown = (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (filtered[active]) pick(filtered[active])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }

        // A blank session renders the chip inside the official hero chip row
        // (portaled); everywhere else it stays in the dock row, aligned with the
        // composer card. chipRef covers button + popup for the outside-click
        // check; buttonRef is what the popup is positioned against.
        const heroSeat = heroRow !== null && typeof createPortal === 'function'
        const popupStyle = {
          left: box ? box.left + 'px' : undefined,
          top: box ? box.top + 'px' : undefined,
          bottom: box ? box.bottom + 'px' : undefined,
          width: box ? box.width + 'px' : 'min(' + POPUP_WIDTH + 'px,88vw)',
          maxHeight: box ? box.maxHeight + 'px' : undefined,
          visibility: box ? undefined : 'hidden',
        }
        /** The panel's own content; rendered once, in whichever seat holds it. */
        const popup = open
          ? h('div', { key: 'popup', ref: popupRef, className: 'dsh-qi-popup', style: popupStyle, 'aria-label': t('trigger') }, [
              h('input', {
                key: 'search',
                ref: searchRef,
                className: 'dsh-qi-search',
                type: 'search',
                value: query,
                placeholder: t('searchPlaceholder'),
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: onSearchKeyDown,
              }),
              h(
                'div',
                { key: 'list', className: 'dsh-qi-list', role: 'listbox' },
                filtered.length === 0
                  ? [h('div', { key: 'empty', className: 'dsh-qi-empty', children: list.length === 0 ? t('popupEmptyAll') : t('popupEmpty') })]
                  : filtered.map((item, index) =>
                      h(
                        'button',
                        {
                          key: item.id,
                          type: 'button',
                          role: 'option',
                          className: 'dsh-qi-row',
                          'data-active': index === active ? 'true' : undefined,
                          'aria-selected': index === active ? 'true' : 'false',
                          onMouseEnter: () => setActive(index),
                          onClick: () => pick(item),
                        },
                        [
                          h('span', { key: 'label', className: 'dsh-qi-row-label', children: item.label || t('untitled') }),
                          h('span', { key: 'content', className: 'dsh-qi-row-content', children: preview(item.content) }),
                        ],
                      ),
                    ),
              ),
              h('div', { key: 'hint', className: 'dsh-qi-hint', children: t('popupHint') }),
            ])
          : null
        const chip = h('div', { key: 'chip', ref: chipRef, className: 'dsh-qi-anchor' }, [
          h('style', { key: 'css', children: CSS }),
          h(
            'button',
            {
              key: 'trigger',
              ref: buttonRef,
              type: 'button',
              className: heroSeat ? 'dsh-qi-trigger dsh-qi-trigger-hero' : 'dsh-qi-trigger',
              title: t('triggerTitle'),
              'aria-haspopup': 'listbox',
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => setOpen((value) => !value),
            },
            [
              h('span', { key: 'icon', className: 'dsh-qi-trigger-icon', 'aria-hidden': 'true', children: '⚡' }),
              h('span', { key: 'label', children: t('trigger') }),
            ],
          ),
          // Without react-dom there is no portal: the popup then stays nested in
          // the dock row, open in the same direction (upward), painted under the
          // composer card. Degraded but never broken.
          createPortal ? null : popup,
        ])
        // The dock row is the chip's home; in the hero phase it only holds the
        // hidden probe while the chip is rendered inside the hero chip row.
        return h(React.Fragment, null, [
          h(
            'div',
            { key: 'row', ref: probeRef, className: heroSeat ? 'dsh-qi-probe' : 'dsh-qi-dock' },
            heroSeat ? null : chip,
          ),
          heroSeat ? createPortal(chip, heroRow, 'chip-portal') : null,
          // The popup leaves the composer subtree on purpose: the dock row is
          // painted under the input card, so an attached popup would be covered
          // by it. See placePopup().
          open && createPortal ? createPortal(popup, document.body, 'popup-portal') : null,
        ])
      }
    }

    /** The settings seat: add / edit / delete / search over the same list. */
    function makeSettings(t, locale) {
      return function QuickInputSettings() {
        useLocaleRevision(locale)
        const state = useStore()
        const list = state.items || []
        const [query, setQuery] = useState('')
        const [newLabel, setNewLabel] = useState('')
        const [newContent, setNewContent] = useState('')
        const [editingId, setEditingId] = useState(null)
        const [editLabel, setEditLabel] = useState('')
        const [editContent, setEditContent] = useState('')
        const [confirmId, setConfirmId] = useState(null)
        const [confirmReset, setConfirmReset] = useState(false)
        const [notice, setNotice] = useState('')

        useEffect(() => {
          // Force a re-read when an earlier attempt failed: this page is where the
          // user goes to fix things, so entering it should retry the content.
          void load(state.errorKind === 'load')
        }, [])

        const filtered = useMemo(() => filterItems(list, query), [list, query])
        const canAdd = newContent.trim().length > 0

        const submitNew = () => {
          if (!canAdd) {
            setNotice(t('emptyContent'))
            return
          }
          addItem(newLabel, newContent)
          setNewLabel('')
          setNewContent('')
          setNotice(t('saved'))
        }

        const startEdit = (item) => {
          setEditingId(item.id)
          setEditLabel(item.label || '')
          setEditContent(typeof item.content === 'string' ? item.content : '')
          setConfirmId(null)
        }

        const commitEdit = () => {
          if (editContent.trim().length === 0) {
            setNotice(t('emptyContent'))
            return
          }
          updateItem(editingId, { label: editLabel.trim(), content: editContent })
          setEditingId(null)
          setNotice(t('saved'))
        }

        /** Two-step delete: the first click arms the row, the second one deletes. */
        const askRemove = (id) => {
          if (confirmId === id) {
            removeItem(id)
            setConfirmId(null)
            setNotice(t('saved'))
            return
          }
          setConfirmId(id)
          setNotice('')
        }

        const restoreDefaults = () => {
          if (!confirmReset) {
            setConfirmReset(true)
            setNotice('')
            return
          }
          // The seeds ship in content/defaults.json and only exist here once a
          // route answer has delivered them. Without this guard a restore during
          // an outage would PUT an empty list and destroy the user's entries —
          // the one destructive write this plugin can make.
          const seeds = seedItems()
          if (seeds.length === 0) {
            setConfirmReset(false)
            setNotice(t('resetUnavailable'))
            return
          }
          setConfirmReset(false)
          setEditingId(null)
          setConfirmId(null)
          setNotice(t('saved'))
          void persist(seeds)
        }

        const row = (item) => {
          const editing = editingId === item.id
          const actions = editing
            ? [
                h('button', { key: 'save', type: 'button', className: 'dsh-qi-btn dsh-qi-btn-primary', onClick: commitEdit, children: t('save') }),
                h('button', { key: 'cancel', type: 'button', className: 'dsh-qi-btn', onClick: () => setEditingId(null), children: t('cancel') }),
              ]
            : [
                h('button', { key: 'edit', type: 'button', className: 'dsh-qi-btn', onClick: () => startEdit(item), children: t('edit') }),
                h('button', {
                  key: 'remove',
                  type: 'button',
                  className: 'dsh-qi-btn dsh-qi-btn-danger',
                  'data-confirm': confirmId === item.id ? 'true' : undefined,
                  onClick: () => askRemove(item.id),
                  children: confirmId === item.id ? t('confirmRemove') : t('remove'),
                }),
              ]
          const main = editing
            ? [
                h('input', {
                  key: 'label',
                  className: 'dsh-qi-input',
                  type: 'text',
                  value: editLabel,
                  maxLength: 100,
                  placeholder: t('labelPlaceholder'),
                  onChange: (event) => setEditLabel(event.target.value),
                }),
                h('textarea', {
                  key: 'content',
                  className: 'dsh-qi-textarea',
                  value: editContent,
                  placeholder: t('contentPlaceholder'),
                  onChange: (event) => setEditContent(event.target.value),
                }),
              ]
            : [
                h('div', { key: 'label', className: 'dsh-qi-item-label', children: item.label || t('untitled') }),
                h('div', { key: 'content', className: 'dsh-qi-item-content', children: item.content }),
              ]
          return h('div', { key: item.id, className: 'dsh-qi-item' }, [
            h('div', { key: 'main', className: 'dsh-qi-item-main' }, main),
            h('div', { key: 'actions', className: 'dsh-qi-item-actions' }, actions),
          ])
        }

        const status = state.errorKind
          ? { text: state.errorKind === 'load' ? t('loadFailed') : t('saveFailed'), className: 'dsh-qi-status dsh-qi-status-err' }
          : state.saving
            ? { text: t('saving'), className: 'dsh-qi-status' }
            : state.loading
              ? { text: t('loading'), className: 'dsh-qi-status' }
              : { text: notice, className: 'dsh-qi-status dsh-qi-status-ok' }

        return h('section', { className: 'dsh-qi-section' }, [
          h('style', { key: 'css', children: CSS }),
          h('h2', { key: 'title', className: 'dsh-qi-h2', children: t('nav') }),
          h('p', { key: 'intro', className: 'dsh-qi-p', children: t('intro') }),

          // Add
          h('div', { key: 'add', className: 'dsh-qi-card' }, [
            h('div', { key: 'head', className: 'dsh-qi-card-title', children: t('addSection') }),
            h('label', { key: 'label', className: 'dsh-qi-field' }, [
              h('span', { key: 'text', children: t('labelLabel') }),
              h('input', {
                key: 'input',
                className: 'dsh-qi-input',
                type: 'text',
                value: newLabel,
                maxLength: 100,
                placeholder: t('labelPlaceholder'),
                onChange: (event) => setNewLabel(event.target.value),
              }),
            ]),
            h('label', { key: 'content', className: 'dsh-qi-field' }, [
              h('span', { key: 'text', children: t('contentLabel') }),
              h('textarea', {
                key: 'input',
                className: 'dsh-qi-textarea',
                value: newContent,
                placeholder: t('contentPlaceholder'),
                onChange: (event) => setNewContent(event.target.value),
                onKeyDown: (event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    submitNew()
                  }
                },
              }),
            ]),
            h('div', { key: 'actions', className: 'dsh-qi-actions' }, [
              h('button', {
                key: 'add',
                type: 'button',
                className: 'dsh-qi-btn dsh-qi-btn-primary',
                disabled: !canAdd || state.saving,
                onClick: submitNew,
                children: t('add'),
              }),
              h('span', { key: 'hint', className: 'dsh-qi-hint', children: t('addHint') }),
            ]),
          ]),

          // Existing entries
          h('div', { key: 'list', className: 'dsh-qi-card' }, [
            h('div', { key: 'head', className: 'dsh-qi-listhead' }, [
              h('span', { key: 'title', className: 'dsh-qi-card-title', children: t('listSection') }),
              h('span', { key: 'count', className: 'dsh-qi-hint', children: t('count').replace('{n}', String(list.length)) }),
            ]),
            list.length > 0
              ? h('input', {
                  key: 'search',
                  className: 'dsh-qi-search',
                  type: 'search',
                  value: query,
                  placeholder: t('searchPlaceholder'),
                  onChange: (event) => setQuery(event.target.value),
                })
              : null,
            filtered.length === 0
              ? h('div', { key: 'empty', className: 'dsh-qi-empty', children: list.length === 0 ? t('empty') : t('noMatch') })
              : filtered.map(row),
          ]),

          // Actions and status
          h('div', { key: 'foot', className: 'dsh-qi-actions' }, [
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'dsh-qi-btn',
              disabled: state.saving,
              onClick: restoreDefaults,
              children: confirmReset ? t('confirmReset') : t('reset'),
            }),
            h('span', { key: 'status', className: status.className, children: status.text }),
          ]),
          h('p', { key: 'path', className: 'dsh-qi-p' }, [
            h('span', { key: 'hint', className: 'dsh-qi-hint', children: state.filePath ? t('pathHint') : t('pathHintUnknown') }),
            state.filePath ? h('span', { key: 'path', className: 'dsh-qi-mono', children: state.filePath }) : null,
          ]),
          h('p', { key: 'resetHint', className: 'dsh-qi-hint', children: t('resetHint') }),
        ])
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        localeService = ctx.locale
        const locale = ctx.locale
        const t = locale.bind(NS)

        // The UI text and the seed entries are NOT registered here: they live in
        // locale/<lang>.json and content/defaults.json, are read by the Host half,
        // and reach this half over the data route. `load()` then calls
        // publishDictionaries() to register them per language id. Registering a
        // placeholder here would be wrong twice over — it would shadow the
        // shipped text until `load()` replaces it, and the registry refuses a
        // second dictionary for a (namespace, language) pair.

        // Pick up languages that appear later, re-trying ids whose dictionary had
        // not been fetched yet. The subscription is an effect of this context.
        ctx.effect(() => locale.subscribe(() => publishDictionaries()))

        // Hand the dictionaries back on unload. The locale service refuses a
        // second registration for a (namespace, language) pair for as long as
        // the first one stands, so a reload that skipped this would leave every
        // text resolved from a dead instance's dictionaries.
        ctx.effect(() => () => {
          for (const dispose of dictionaryDisposers.splice(0)) {
            try {
              dispose()
            } catch {
              /* already gone */
            }
          }
          registered.clear()
        })

        const Trigger = makeTrigger(t, locale)
        const Settings = makeSettings(t, locale)

        // The settings nav row's glyph (the slot itself cannot carry one).
        installSettingsNavIcon(ctx, () => t('nav'))

        // The first load owns the dictionaries, so pull them in as soon as the
        // plugin is applied rather than when a seat first renders: the settings
        // nav row is drawn by the shell before either seat mounts, so a late
        // registration would leave it labelled with the raw namespace key.
        void load()

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'quick-input', order: 5 }, Trigger),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'quick-input', order: 30, label: () => t('nav') }, Settings),
        )
      },
    }
  },
})