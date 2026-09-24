/**
 * Client half of the Quick Input bundle.
 *
 * Two seats, one document:
 *   1. `conversation.input.dock` — the 【快捷输入】 button above the composer and
 *      its candidate popup; picking a candidate inserts it into the composer.
 *   2. `settings.section` — the settings page that maintains the candidates
 *      (add / edit / delete / search).
 *
 * The document itself is owned by the Host half at
 * `<DSH home>/quick-input/items.json`, reached through the same-origin route
 * `/dsh-quick-input/items`. This file holds the shared store both seats read,
 * so a change made in Settings is visible to the composer popup at once.
 *
 * Plain JavaScript on purpose: React comes from the browser module table, the
 * plugin imports no Harness Client package, and styles use only `--dsw-alias-*`
 * tokens.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-quick-input',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useMemo, useRef } = React
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
    /** Host route owning the quick-input document. */
    const ROUTE = '/dsh-quick-input/items'

    const ZH = {
      nav: '快捷输入',
      intro: '维护「快捷输入」候选内容：在输入框上方的【快捷输入】按钮中点选任意一条，即可填入输入框；内容保存在本机，重启后仍在。',
      trigger: '快捷输入',
      triggerTitle: '快捷输入：点选候选内容填入输入框',
      popupHint: '在 设置 → 快捷输入 中维护这份列表',
      popupEmpty: '没有匹配的内容',
      popupEmptyAll: '还没有快捷输入，请到 设置 → 快捷输入 中添加',
      searchPlaceholder: '搜索快捷输入…',
      untitled: '未命名',
      addSection: '新增内容',
      addHint: 'Ctrl/⌘ + Enter 快速添加',
      labelLabel: '名称',
      labelPlaceholder: '例如：代码审查',
      contentLabel: '内容',
      contentPlaceholder: '例如：请审查下面的代码，指出潜在的 bug、边界情况与可改进点：',
      add: '添加',
      listSection: '已有内容',
      count: '共 {n} 条',
      empty: '暂无内容，请在上方新增。',
      noMatch: '没有匹配的内容。',
      edit: '编辑',
      remove: '删除',
      confirmRemove: '确认删除',
      save: '保存',
      cancel: '取消',
      reset: '恢复默认',
      confirmReset: '确认恢复默认',
      resetHint: '「恢复默认」会用内置示例覆盖当前列表（不影响其它设置）。',
      loading: '读取中…',
      saving: '保存中…',
      saved: '已保存',
      loadFailed: '无法读取快捷输入数据（宿主路由不可用），当前改动只存在于页面内存中。',
      saveFailed: '保存失败：改动未写入本机数据文件。',
      emptyContent: '内容不能为空。',
      pathHint: '数据文件：',
      pathHintUnknown: '数据文件：读取中…',
      default1Label: '代码审查',
      default1Content: '请审查下面的代码，指出潜在的 bug、边界情况与可改进点：',
      default2Label: '解释说明',
      default2Content: '请解释下面的内容：说明它的原理，并给出一个最小可运行示例。',
      default3Label: '补充测试',
      default3Content: '请为下面的代码补充单元测试，覆盖正常路径与边界情况：',
    }

    const EN = {
      nav: 'Quick Input',
      intro:
        'Maintain your quick-input candidates: pick one from the 【Quick Input】 button above the composer to insert it into the input box. Entries are stored on this machine and survive restarts.',
      trigger: 'Quick Input',
      triggerTitle: 'Quick Input: pick a candidate to fill the input box',
      popupHint: 'Maintain this list under Settings → Quick Input',
      popupEmpty: 'No matching entry',
      popupEmptyAll: 'No quick input yet — add one under Settings → Quick Input',
      searchPlaceholder: 'Search quick input…',
      untitled: 'Untitled',
      addSection: 'Add an entry',
      addHint: 'Ctrl/⌘ + Enter to add',
      labelLabel: 'Name',
      labelPlaceholder: 'e.g. Code review',
      contentLabel: 'Content',
      contentPlaceholder: 'e.g. Review the code below for potential bugs, edge cases, and improvements:',
      add: 'Add',
      listSection: 'Existing entries',
      count: '{n} total',
      empty: 'Nothing here yet — add one above.',
      noMatch: 'No matching entry.',
      edit: 'Edit',
      remove: 'Delete',
      confirmRemove: 'Confirm delete',
      save: 'Save',
      cancel: 'Cancel',
      reset: 'Restore defaults',
      confirmReset: 'Confirm restore',
      resetHint: 'Restore defaults overwrites the current list with the built-in examples.',
      loading: 'Loading…',
      saving: 'Saving…',
      saved: 'Saved',
      loadFailed: 'Cannot read the quick-input document (host route unavailable); changes live in this page only.',
      saveFailed: 'Save failed: changes were not written to the local data file.',
      emptyContent: 'Content must not be empty.',
      pathHint: 'Data file: ',
      pathHintUnknown: 'Data file: loading…',
      default1Label: 'Code review',
      default1Content: 'Review the code below for potential bugs, edge cases, and improvements:',
      default2Label: 'Explain',
      default2Content: 'Explain the content below: why it works, plus a minimal runnable example.',
      default3Label: 'Add tests',
      default3Content: 'Add unit tests for the code below, covering the happy path and edge cases:',
    }

    /** Built-in seed entries, materialized in the active locale on first run. */
    const DEFAULT_SPECS = [
      { id: 'default-code-review', labelKey: 'default1Label', contentKey: 'default1Content' },
      { id: 'default-explain', labelKey: 'default2Label', contentKey: 'default2Content' },
      { id: 'default-add-tests', labelKey: 'default3Label', contentKey: 'default3Content' },
    ]

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
      '.dsh-qi-popup{position:absolute;bottom:calc(100% + 6px);left:0;z-index:2147483000;width:min(440px,88vw);display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 30px rgba(0,0,0,.28)}',
      // Hero chip row sits above the input card: the popup opens DOWNWARD there,
      // like the official workspace picker anchored under the same row.
      '.dsh-qi-popup-hero{bottom:auto;top:calc(100% + 6px)}',
      '.dsh-qi-search{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:5px 10px;font-size:13px;font-family:inherit;outline:none}',
      '.dsh-qi-list{max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}',
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
    /** Set by apply(): builds the built-in seeds in the active locale. */
    let makeDefaults = () => []

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

    /** Read once (or force a re-read) from the host document. */
    async function load(force) {
      if (loading) return
      if (loaded && !force) return
      loading = true
      emit()
      try {
        const data = await request('GET')
        if (data && Array.isArray(data.items)) {
          items = data.items
          seeded = true
        } else if (!seeded) {
          items = makeDefaults()
          seeded = true
          void persist(items) // first run: materialize the seeds so Settings lists real rows
        }
        if (data && typeof data.path === 'string') filePath = data.path
        errorKind = ''
      } catch {
        if (!seeded) {
          items = makeDefaults()
          seeded = true
        }
        errorKind = 'load'
      } finally {
        loading = false
        loaded = true
        emit()
      }
    }

    /** Apply a new list optimistically, then write it through the host route. */
    async function persist(next) {
      items = next
      saving = true
      emit()
      try {
        const data = await request('PUT', { items: next })
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
        style.dataset.plugin = '@local/dsh-quick-input'
        style.dataset.pluginCss = '@local/dsh-quick-input/settings-nav-icon'
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
        const searchRef = useRef(null)
        /** The hero chip row while a blank session renders one; null otherwise. */
        const [heroRow, setHeroRow] = useState(null)

        useEffect(() => {
          void load()
        }, [])

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
            if (chip && !chip.contains(event.target)) setOpen(false)
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
        // composer card. chipRef covers button + popup for the outside-click check.
        const heroSeat = heroRow !== null && typeof createPortal === 'function'
        const chip = h('div', { key: 'chip', ref: chipRef, className: 'dsh-qi-anchor' }, [
          h('style', { key: 'css', children: CSS }),
          h(
            'button',
            {
              key: 'trigger',
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
          open
            ? h('div', { key: 'popup', className: heroSeat ? 'dsh-qi-popup dsh-qi-popup-hero' : 'dsh-qi-popup', 'aria-label': t('trigger') }, [
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
            : null,
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
          void load()
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
          setConfirmReset(false)
          setEditingId(null)
          setConfirmId(null)
          setNotice(t('saved'))
          void persist(makeDefaults())
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
        const locale = ctx.locale
        const t = locale.bind(NS)
        makeDefaults = () => DEFAULT_SPECS.map((spec) => ({ id: spec.id, label: t(spec.labelKey), content: t(spec.contentKey) }))

        // Register this plugin's own UI text for every known locale (Chinese
        // ids get the Chinese dictionary, everything else English), and pick
        // up languages that appear later. Both the registrations and the
        // subscription are effects of this plugin's context.
        const registered = new Set()
        const dictionaryDisposers = []
        const ensureDictionary = (id) => {
          if (typeof id !== 'string' || id.length === 0 || registered.has(id)) return
          try {
            dictionaryDisposers.push(locale.register(NS, id, /^zh/i.test(id) ? ZH : EN))
            registered.add(id)
          } catch {
            /* an id the registry refuses is simply left to the shared fallback */
          }
        }
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
        try {
          const snapshot = locale.getLocale()
          for (const definition of snapshot.locales) ensureDictionary(definition.id)
          ensureDictionary(snapshot.active)
        } catch {
          ensureDictionary('en')
        }
        ctx.effect(() =>
          locale.subscribe(() => {
            try {
              ensureDictionary(locale.getLocale().active)
            } catch {
              /* locale service unavailable: keep what is registered */
            }
          }),
        )

        const Trigger = makeTrigger(t, locale)
        const Settings = makeSettings(t, locale)

        // The settings nav row's glyph (the slot itself cannot carry one).
        installSettingsNavIcon(ctx, () => t('nav'))

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