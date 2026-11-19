export function mountIntakeDrawer(config = {}) {
  if (window.__AI2H_INTAKE_MOUNTED__) return
  window.__AI2H_INTAKE_MOUNTED__ = true

  const STATUSES = ['received', 'unclear', 'scoped', 'qualified', 'completed', 'failed', 'archived']
  const CATEGORIES = ['feature', 'bug', 'ui']
  const KINDS = [...CATEGORIES, 'unknown']
  const CONSOLE_BUFFER_MAX = 100
  const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug']

  const consoleBuffer = []

  function pushConsoleEntry(level, args) {
    let message = ''
    try {
      message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg
          if (arg instanceof Error) return arg.stack || arg.message || String(arg)
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
    } catch {
      message = '[unserializable console args]'
    }
    if (message.length > 8000) message = message.slice(0, 8000)
    consoleBuffer.push({
      level,
      message,
      timestamp: new Date().toISOString(),
    })
    if (consoleBuffer.length > CONSOLE_BUFFER_MAX) {
      consoleBuffer.splice(0, consoleBuffer.length - CONSOLE_BUFFER_MAX)
    }
  }

  const originalConsole = {}
  for (const level of CONSOLE_LEVELS) {
    const original = console[level] ? console[level].bind(console) : console.log.bind(console)
    originalConsole[level] = original
    console[level] = (...args) => {
      pushConsoleEntry(level, args)
      return original(...args)
    }
  }

  const previousOnError = window.onerror
  window.onerror = function onIntakeError(message, source, lineno, colno, error) {
    const parts = [String(message || 'window.onerror')]
    if (source) parts.push(`at ${source}:${lineno || 0}:${colno || 0}`)
    if (error && error.stack) parts.push(String(error.stack))
    pushConsoleEntry('error', [parts.join(' ')])
    if (typeof previousOnError === 'function') {
      return previousOnError.apply(this, arguments)
    }
    return false
  }

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    if (reason instanceof Error) {
      pushConsoleEntry('error', [`Unhandled rejection: ${reason.stack || reason.message}`])
    } else {
      pushConsoleEntry('error', [`Unhandled rejection: ${String(reason)}`])
    }
  })

  function snapshotClientContext() {
    return {
      user_agent: navigator.userAgent || '',
      page_url: location.href || '',
      console_logs: consoleBuffer.slice(-CONSOLE_BUFFER_MAX),
    }
  }

  const directMode = config.mode === 'direct'
  const apiBase = String(config.apiBase || '/__intake').replace(/\/$/, '')
  const MEMORY_KEY = `ai2h-intake:memory:${apiBase}`
  const otpEnabled = config.otp !== false
  const SESSION_KEY = `ai2h-intake:session:${apiBase}`
  const REVEAL_KEY = `ai2h-intake:revealed:${apiBase}`
  const revealSequence = typeof config.shortcut === 'string' ? config.shortcut.toLowerCase() : ''
  const revealRequired = Boolean(revealSequence)

  function sessionHeaders(token) {
    return directMode ? { Authorization: `Bearer ${token}` } : { 'X-Intake-Session': token }
  }

  function csrfHeaders() {
    if (directMode) return {}
    const fromConfig = typeof config.csrfToken === 'string' ? config.csrfToken : ''
    const fromMeta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
    const token = fromConfig || fromMeta
    return token ? { 'X-CSRF-Token': token } : {}
  }

  function readStoredSession() {
    try {
      const data = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
      if (!data || typeof data.token !== 'string' || typeof data.expiresAt !== 'string') return null
      if (Date.parse(data.expiresAt) <= Date.now()) {
        localStorage.removeItem(SESSION_KEY)
        return null
      }
      return data
    } catch {
      return null
    }
  }

  function storeSession(session) {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      // quota / private mode
    }
  }

  function readRevealed() {
    if (!revealRequired) return true
    if (readStoredSession()) return true
    try {
      return sessionStorage.getItem(REVEAL_KEY) === '1'
    } catch {
      return false
    }
  }

  function storeRevealed(revealed) {
    try {
      if (revealed) sessionStorage.setItem(REVEAL_KEY, '1')
      else sessionStorage.removeItem(REVEAL_KEY)
    } catch {
      // private mode
    }
  }

  const state = {
    revealed: readRevealed(),
    session: otpEnabled ? readStoredSession() : null,
    auth: {
      step: 'email',
      email: '',
      code: '',
      busy: false,
      error: '',
      info: '',
    },
    open: false,
    /** Categories the user may use, from GET /authorization. `null` until loaded. */
    categories: null,
    authzLoading: false,
    authzError: '',
    tab: 'create',
    createStep: 1,
    kind: null,
    bodyDraft: '',
    statusFilter: '',
    search: '',
    files: [],
    intakes: [],
    listTotal: 0,
    statusCounts: {},
    loadingList: false,
    submitting: false,
    expandedClarifyId: null,
    expandedListId: null,
    clarifyDrafts: {},
    clarifyCategories: {},
    clarifyingId: null,
    clarifyError: '',
    clarifyOk: '',
    verifyingId: null,
    verifyError: '',
    verifyOk: '',
    archivingId: null,
    archiveError: '',
    archiveOk: '',
  }

  function loadMemory() {
    try {
      const raw = localStorage.getItem(MEMORY_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object') return

      if (
        data.tab === 'create' ||
        data.tab === 'clarify' ||
        data.tab === 'verify' ||
        data.tab === 'list'
      ) {
        state.tab = data.tab
      }
      if (data.createStep === 1 || data.createStep === 2) {
        state.createStep = data.createStep
      }
      if (KINDS.includes(data.kind)) {
        state.kind = data.kind
      }
      if (typeof data.bodyDraft === 'string') state.bodyDraft = data.bodyDraft
      if (typeof data.statusFilter === 'string') state.statusFilter = data.statusFilter
      if (typeof data.search === 'string') state.search = data.search
      if (data.clarifyDrafts && typeof data.clarifyDrafts === 'object') {
        state.clarifyDrafts = data.clarifyDrafts
      }
      if (data.clarifyCategories && typeof data.clarifyCategories === 'object') {
        state.clarifyCategories = data.clarifyCategories
      }
      if (typeof data.expandedClarifyId === 'string' || data.expandedClarifyId === null) {
        state.expandedClarifyId = data.expandedClarifyId
      }
      if (typeof data.expandedListId === 'string' || data.expandedListId === null) {
        state.expandedListId = data.expandedListId
      }
    } catch {
      // ignore corrupt memory
    }
  }

  function saveMemory() {
    try {
      localStorage.setItem(
        MEMORY_KEY,
        JSON.stringify({
          tab: state.tab,
          createStep: state.createStep,
          kind: state.kind,
          bodyDraft: state.bodyDraft,
          statusFilter: state.statusFilter,
          search: state.search,
          clarifyDrafts: state.clarifyDrafts,
          clarifyCategories: state.clarifyCategories,
          expandedClarifyId: state.expandedClarifyId,
          expandedListId: state.expandedListId,
        })
      )
    } catch {
      // quota / private mode
    }
  }

  const FILES_DB = 'ai2h-intake-files'
  const FILES_STORE = 'drafts'

  function openFilesDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FILES_DB, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async function saveFilesMemory() {
    try {
      const records = state.files.map((entry) => ({
        id: entry.id,
        name: entry.file.name,
        type: entry.file.type,
        lastModified: entry.file.lastModified,
        blob: entry.file,
      }))
      const db = await openFilesDb()
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readwrite')
        tx.objectStore(FILES_STORE).put(records, MEMORY_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    } catch {
      // IndexedDB unavailable
    }
  }

  async function loadFilesMemory() {
    try {
      const db = await openFilesDb()
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readonly')
        const request = tx.objectStore(FILES_STORE).get(MEMORY_KEY)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })
      db.close()
      if (!Array.isArray(records) || records.length === 0) return

      revokePreviews()
      state.files = records
        .filter((rec) => rec && rec.blob)
        .map((rec) => {
          const file = new File([rec.blob], rec.name || 'capture.png', {
            type: rec.type || 'image/png',
            lastModified: rec.lastModified || Date.now(),
          })
          return {
            id: rec.id || `${file.name}-${file.size}-${Math.random()}`,
            file,
            previewUrl: URL.createObjectURL(file),
          }
        })
    } catch {
      // IndexedDB unavailable
    }
  }

  async function clearFilesMemory() {
    try {
      const db = await openFilesDb()
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readwrite')
        tx.objectStore(FILES_STORE).put([], MEMORY_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    } catch {
      // IndexedDB unavailable
    }
  }

  async function resetCreateForm() {
    state.createStep = 1
    state.kind = null
    state.bodyDraft = ''
    revokePreviews()
    state.files = []
    state.createError = ''
    state.createOk = ''
    applyCategoryAccess()
    saveMemory()
    await clearFilesMemory()
  }

  function allowedCategories() {
    return Array.isArray(state.categories) ? state.categories : []
  }

  /** Keeps the create form consistent with the categories the user may use. */
  function applyCategoryAccess() {
    if (!Array.isArray(state.categories)) return
    const allowed = state.categories
    if (allowed.length === 1) {
      // A single category: preselect it and skip the type step.
      state.kind = allowed[0]
      state.createStep = 2
    } else if (
      state.kind &&
      (state.kind === 'unknown' ? allowed.length < 2 : !allowed.includes(state.kind))
    ) {
      state.kind = null
      state.createStep = 1
    }
    for (const [id, category] of Object.entries(state.clarifyCategories)) {
      if (category && !allowed.includes(category)) delete state.clarifyCategories[id]
    }
  }

  async function loadAuthorization() {
    if (needsLogin() || state.authzLoading) return
    state.authzLoading = true
    state.authzError = ''
    render()
    try {
      const response = await apiFetch(`${apiBase}/authorization`, {
        headers: { Accept: 'application/json' },
      })
      if (response.status === 404) {
        // Intake API without per-user authorization: every category is allowed.
        state.categories = [...CATEGORIES]
      } else if (!response.ok) {
        throw new Error(await errorMessage(response, 'Impossible de charger vos autorisations'))
      } else {
        const payload = await response.json()
        const granted = Array.isArray(payload?.categories) ? payload.categories : []
        state.categories = CATEGORIES.filter((category) => granted.includes(category))
      }
      applyCategoryAccess()
      saveMemory()
    } catch (error) {
      state.authzError =
        error instanceof Error ? error.message : 'Impossible de charger vos autorisations'
    } finally {
      state.authzLoading = false
      render()
    }
  }

  function activeSession() {
    if (!otpEnabled || !state.session) return null
    if (Date.parse(state.session.expiresAt) <= Date.now()) {
      state.session = null
      storeSession(null)
      return null
    }
    return state.session
  }

  function needsLogin() {
    return otpEnabled && !activeSession()
  }

  function expireSession(message) {
    state.session = null
    state.categories = null
    storeSession(null)
    state.auth.step = 'email'
    state.auth.code = ''
    state.auth.error = message
    state.auth.info = ''
  }

  async function apiFetch(url, init = {}) {
    const session = activeSession()
    const headers = { ...(init.headers || {}) }
    if (session) Object.assign(headers, sessionHeaders(session.token))
    const response = await fetch(url, { ...init, headers })
    if (otpEnabled && response.status === 401) {
      expireSession('Session expirée, reconnectez-vous')
      throw new Error('Session expirée, reconnectez-vous')
    }
    return response
  }

  async function errorMessage(response, fallback) {
    const text = await response.text()
    try {
      const payload = JSON.parse(text)
      if (payload && typeof payload.error === 'string') return payload.error
      if (payload && typeof payload.detail === 'string') return payload.detail
      if (payload && Array.isArray(payload.detail)) {
        return payload.detail.map((item) => item?.msg || JSON.stringify(item)).join(', ')
      }
    } catch {
      // not JSON
    }
    return text || `${fallback} (${response.status})`
  }

  function focusAuthInput() {
    requestAnimationFrame(() => document.getElementById('ai2h-intake-auth-input')?.focus())
  }

  async function submitRequestOtp(event) {
    if (event) event.preventDefault()
    const email = state.auth.email.trim()
    if (!email || state.auth.busy) return

    state.auth.busy = true
    state.auth.error = ''
    state.auth.info = ''
    render()

    try {
      const response = await fetch(`${apiBase}/browser-auth/request-otp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) throw new Error(await errorMessage(response, 'Envoi du code impossible'))
      state.auth.step = 'code'
      state.auth.code = ''
      state.auth.info = 'Si cet email est autorisé, un code vient de lui être envoyé.'
    } catch (error) {
      state.auth.error = error instanceof Error ? error.message : 'Envoi du code impossible'
    } finally {
      state.auth.busy = false
      render()
      focusAuthInput()
    }
  }

  async function submitVerifyOtp(event) {
    if (event) event.preventDefault()
    const code = state.auth.code.trim()
    if (!/^\d{6}$/.test(code) || state.auth.busy) {
      state.auth.error = 'Le code contient 6 chiffres'
      render()
      focusAuthInput()
      return
    }

    state.auth.busy = true
    state.auth.error = ''
    render()

    try {
      const response = await fetch(`${apiBase}/browser-auth/verify-otp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        body: JSON.stringify({ email: state.auth.email.trim(), code }),
      })
      if (response.status === 401) throw new Error('Code invalide ou expiré')
      if (!response.ok) throw new Error(await errorMessage(response, 'Vérification impossible'))
      const payload = await response.json()
      state.session = { token: payload.session_token, expiresAt: payload.expires_at }
      storeSession(state.session)
      state.auth = { step: 'email', email: state.auth.email, code: '', busy: false, error: '', info: '' }
      loadAuthorization()
      loadIntakes()
    } catch (error) {
      state.auth.error = error instanceof Error ? error.message : 'Vérification impossible'
      state.auth.busy = false
      render()
      focusAuthInput()
    }
  }

  function logout() {
    const session = activeSession()
    if (session) {
      fetch(`${apiBase}/browser-auth/logout`, {
        method: 'POST',
        headers: { ...sessionHeaders(session.token), ...csrfHeaders() },
      }).catch(() => {})
    }
    state.session = null
    state.categories = null
    storeSession(null)
    state.open = false
    state.revealed = !revealRequired
    storeRevealed(false)
    state.intakes = []
    state.listTotal = 0
    state.statusCounts = {}
    render()
  }

  function toggleFromShortcut() {
    if (!state.revealed) {
      state.revealed = true
      storeRevealed(true)
      openDrawer()
      if (needsLogin()) focusAuthInput()
      return
    }
    if (state.open) {
      closeDrawer()
    } else {
      openDrawer()
      if (needsLogin()) focusAuthInput()
    }
  }

  function resolveCategory() {
    const allowed = allowedCategories()
    if (allowed.includes(state.kind)) return state.kind
    // "Je ne sais pas": file it under an allowed category, qualification will refine it.
    if (allowed.includes('feature')) return 'feature'
    return allowed[0] || 'feature'
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') node.className = value
      else if (key === 'text') node.textContent = value
      else if (key === 'value') node.value = value == null ? '' : String(value)
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value))
      }
    }
    for (const child of children) {
      if (child == null) continue
      node.append(child)
    }
    return node
  }

  function revokePreviews() {
    for (const file of state.files) {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
    }
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString('fr-FR')
    } catch {
      return value
    }
  }

  function countByStatus(items) {
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]))
    for (const item of items) {
      const status = item.intake_status
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1
      }
    }
    return counts
  }

  function filteredIntakes() {
    const q = state.search.trim().toLowerCase()
    return state.intakes.filter((item) => {
      if (state.statusFilter && item.intake_status !== state.statusFilter) return false
      if (!q) return true
      const hay = `${item.intake_title || ''} ${item.intake_body || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }

  function unclearIntakes() {
    return state.intakes.filter((item) => item.intake_status === 'unclear')
  }

  function unclearCount() {
    return state.statusCounts.unclear || unclearIntakes().length
  }

  function toVerifyIntakes() {
    return state.intakes.filter(
      (item) => item.intake_status === 'completed' && !item.intake_verified_at
    )
  }

  function toVerifyCount() {
    return toVerifyIntakes().length
  }

  function canArchive(item) {
    if (!item || item.intake_status === 'archived') {
      return false
    }
    if (item.intake_status === 'completed') {
      return true
    }
    if (item.intake_status === 'scoped') {
      return false
    }
    return item.intake_status === 'received' || !item.intake_scope_id
  }

  function appendClarifyBody(existing, complement) {
    const base = String(existing || '').trim()
    const extra = String(complement || '').trim()
    const stamp = new Date().toLocaleString('fr-FR')
    const block = `Complément (${stamp}) :\n${extra}`
    return base ? `${base}\n\n---\n${block}` : block
  }

  async function submitClarify(intake) {
    if (state.clarifyingId) return
    const draft = String(state.clarifyDrafts[intake.intake_id] || '').trim()
    const category = state.clarifyCategories[intake.intake_id] || ''
    if (!draft && !CATEGORIES.includes(category)) {
      state.clarifyError = 'Ajoutez des détails ou précisez la catégorie'
      state.expandedClarifyId = intake.intake_id
      render()
      return
    }

    const payload = {}
    if (draft) payload.body = appendClarifyBody(intake.intake_body, draft)
    if (CATEGORIES.includes(category)) payload.category = category

    state.clarifyingId = intake.intake_id
    state.clarifyError = ''
    state.clarifyOk = ''
    render()

    try {
      const response = await apiFetch(`${apiBase}/intakes/${intake.intake_id}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await errorMessage(response, 'Échec de la mise à jour'))
      }
      delete state.clarifyDrafts[intake.intake_id]
      delete state.clarifyCategories[intake.intake_id]
      state.expandedClarifyId = null
      state.clarifyOk = 'Complément envoyé — l’intake revient en file de qualification'
      saveMemory()
      await loadIntakes()
    } catch (error) {
      state.clarifyError = error instanceof Error ? error.message : 'Échec de la mise à jour'
      render()
    } finally {
      state.clarifyingId = null
      render()
    }
  }

  async function loadIntakes() {
    state.loadingList = true
    render()
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' })
      const response = await apiFetch(`${apiBase}/intakes?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`Impossible de charger les intakes (${response.status})`)
      const payload = await response.json()
      state.intakes = payload.items || []
      state.listTotal = typeof payload.total === 'number' ? payload.total : state.intakes.length
      state.statusCounts = countByStatus(state.intakes)
      state.listError = ''
    } catch (error) {
      state.listError = error instanceof Error ? error.message : 'Impossible de charger les intakes'
      state.intakes = []
      state.listTotal = 0
      state.statusCounts = {}
    } finally {
      state.loadingList = false
      render()
    }
  }

  async function submitVerify(intake) {
    if (state.verifyingId) return
    if (intake.intake_status !== 'completed' || intake.intake_verified_at) return

    state.verifyingId = intake.intake_id
    state.verifyError = ''
    state.verifyOk = ''
    render()

    try {
      const response = await apiFetch(`${apiBase}/intakes/${intake.intake_id}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...csrfHeaders(),
        },
        body: JSON.stringify({ verified_at: new Date().toISOString() }),
      })
      if (!response.ok) {
        throw new Error(await errorMessage(response, 'Échec de la vérification'))
      }
      state.verifyOk = 'Intake marqué comme vérifié'
      await loadIntakes()
    } catch (error) {
      state.verifyError = error instanceof Error ? error.message : 'Échec de la vérification'
      render()
    } finally {
      state.verifyingId = null
      render()
    }
  }

  async function submitArchive(intake) {
    if (state.archivingId || !canArchive(intake)) return
    const title = String(intake.intake_title || 'cet intake').trim() || 'cet intake'
    if (!window.confirm(`Archiver « ${title} » ? Il sera exclu du pipeline.`)) return

    state.archivingId = intake.intake_id
    state.archiveError = ''
    state.archiveOk = ''
    state.listError = ''
    render()

    try {
      const response = await apiFetch(`${apiBase}/intakes/${intake.intake_id}/archive`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...csrfHeaders(),
        },
      })
      if (!response.ok) {
        throw new Error(await errorMessage(response, 'Échec de l’archivage'))
      }
      if (state.expandedListId === intake.intake_id) state.expandedListId = null
      if (state.expandedClarifyId === intake.intake_id) state.expandedClarifyId = null
      state.archiveOk = 'Intake archivé'
      saveMemory()
      await loadIntakes()
    } catch (error) {
      state.archiveError = error instanceof Error ? error.message : 'Échec de l’archivage'
      render()
    } finally {
      state.archivingId = null
      render()
    }
  }

  function renderArchiveButton(intake) {
    if (!canArchive(intake)) return null
    const busy = state.archivingId === intake.intake_id
    return el('button', {
      type: 'button',
      className: 'ai2h-intake-btn ai2h-intake-btn--danger',
      text: busy ? 'Archivage…' : 'Archiver',
      disabled: busy || state.archivingId ? 'true' : undefined,
      onClick: (event) => {
        event.preventDefault()
        submitArchive(intake)
      },
    })
  }

  async function submitCreate(event) {
    event.preventDefault()
    if (state.submitting) return

    const body = String(state.bodyDraft || '').trim()
    const category = resolveCategory()

    if (!body) {
      state.createError = 'Les détails sont obligatoires'
      render()
      return
    }
    if (!state.kind) {
      state.createError = 'Choisissez d’abord le type d’intake'
      state.createStep = 1
      render()
      return
    }

    const payload = new FormData()
    payload.set('title', '')
    payload.set('category', category)
    payload.set('body', body)
    if (state.kind === 'unknown') {
      payload.set('labels', JSON.stringify(['category-unknown']))
    }
    payload.set('client_context', JSON.stringify(snapshotClientContext()))
    for (const entry of state.files) {
      payload.append('files', entry.file, entry.file.name)
    }

    state.submitting = true
    state.createError = ''
    state.createOk = ''
    render()

    try {
      const response = await apiFetch(`${apiBase}/intakes`, {
        method: 'POST',
        headers: {
          ...csrfHeaders(),
        },
        body: payload,
      })
      if (!response.ok) {
        throw new Error(await errorMessage(response, 'Échec de la création'))
      }
      await resetCreateForm()
      state.createOk = 'Intake publié'
      state.tab = 'list'
      saveMemory()
      await loadIntakes()
    } catch (error) {
      state.createError = error instanceof Error ? error.message : 'Échec de la création'
      render()
    } finally {
      state.submitting = false
      render()
    }
  }

  function selectKind(kind) {
    state.kind = kind
    state.createStep = 2
    state.createError = ''
    saveMemory()
    render()
  }

  function openDrawer(tab) {
    if (state.closing) return
    state.open = true
    if (tab) state.tab = tab
    if (!needsLogin()) {
      loadAuthorization()
      loadIntakes()
    }
    render({ animateOpen: true })
  }

  function closeDrawer() {
    if (!state.open || state.closing) return

    const drawer = document.getElementById('ai2h-intake-drawer')
    const backdrop = document.querySelector('#ai2h-intake-root .ai2h-intake-backdrop')
    if (!drawer) {
      state.open = false
      render()
      return
    }

    state.closing = true
    drawer.classList.remove('is-open')
    if (backdrop) backdrop.classList.remove('is-open')

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      state.closing = false
      state.open = false
      render()
    }

    drawer.addEventListener(
      'transitionend',
      (event) => {
        if (event.target === drawer && event.propertyName === 'transform') finish()
      },
      { once: true }
    )
    setTimeout(finish, 400)
  }

  function addImageFiles(fileList) {
    for (const file of Array.from(fileList || [])) {
      if (!file.type.startsWith('image/')) continue
      state.files.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    saveFilesMemory()
    render()
  }

  function onFilesSelected(event) {
    const input = event.currentTarget
    addImageFiles(input.files)
    input.value = ''
  }

  function removeFile(id) {
    const next = []
    for (const entry of state.files) {
      if (entry.id === id) {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
      } else {
        next.push(entry)
      }
    }
    state.files = next
    saveFilesMemory()
    render()
  }

  function selectRegion() {
    return new Promise((resolve) => {
      const overlay = el('div', { className: 'ai2h-intake-capture-overlay' })
      const shade = el('div', { className: 'ai2h-intake-capture-shade' })
      const box = el('div', { className: 'ai2h-intake-capture-box' })
      const hint = el('div', {
        className: 'ai2h-intake-capture-hint',
        text: 'Glissez pour sélectionner une zone · Échap pour annuler',
      })
      overlay.append(shade, box, hint)
      document.body.append(overlay)

      let start = null

      function cleanup(result) {
        document.removeEventListener('keydown', onKey)
        overlay.remove()
        resolve(result)
      }

      function onKey(event) {
        if (event.key === 'Escape') cleanup(null)
      }

      document.addEventListener('keydown', onKey)

      overlay.addEventListener('mousedown', (event) => {
        event.preventDefault()
        start = { x: event.clientX, y: event.clientY }
        box.style.display = 'block'
        box.style.left = `${start.x}px`
        box.style.top = `${start.y}px`
        box.style.width = '0px'
        box.style.height = '0px'
      })

      overlay.addEventListener('mousemove', (event) => {
        if (!start) return
        const x = Math.min(start.x, event.clientX)
        const y = Math.min(start.y, event.clientY)
        const width = Math.abs(event.clientX - start.x)
        const height = Math.abs(event.clientY - start.y)
        box.style.left = `${x}px`
        box.style.top = `${y}px`
        box.style.width = `${width}px`
        box.style.height = `${height}px`
      })

      overlay.addEventListener('mouseup', (event) => {
        if (!start) return
        const x = Math.min(start.x, event.clientX)
        const y = Math.min(start.y, event.clientY)
        const width = Math.abs(event.clientX - start.x)
        const height = Math.abs(event.clientY - start.y)
        cleanup({ x, y, width, height })
      })
    })
  }

  async function capturePageCanvas(scale) {
    try {
      const { domToCanvas } = await import('https://esm.sh/modern-screenshot@4.6.0')
      return await domToCanvas(document.documentElement, {
        scale,
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        filter: (node) => {
          if (!(node instanceof Element)) return true
          return !node.classList?.contains('ai2h-intake-capture-overlay')
            && node.id !== 'ai2h-intake-root'
        },
      })
    } catch {
      return captureViaDisplayMedia(scale)
    }
  }

  async function captureViaDisplayMedia(scale) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('La capture d’écran n’est pas prise en charge dans ce navigateur')
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    })

    try {
      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video')
      video.playsInline = true
      video.muted = true
      video.srcObject = stream
      await video.play()
      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve()
        else video.onloadeddata = () => resolve()
      })
      await new Promise((resolve) => setTimeout(resolve, 80))

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth))
      canvas.height = Math.max(1, Math.round(video.videoHeight))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Impossible de créer le canevas de capture')
      ctx.drawImage(video, 0, 0)
      track.stop()
      stream.getTracks().forEach((item) => item.stop())

      canvas.__ai2hFromDisplayMedia = true
      return canvas
    } catch (error) {
      stream.getTracks().forEach((item) => item.stop())
      throw error
    }
  }

  async function captureRegion() {
    const root = document.getElementById('ai2h-intake-root')
    state.open = false
    state.capturing = true
    state.createError = ''
    render()
    if (root) root.style.visibility = 'hidden'

    try {
      const rect = await selectRegion()
      if (!rect || rect.width < 8 || rect.height < 8) {
        return
      }

      const scale = window.devicePixelRatio || 1
      const full = await capturePageCanvas(scale)

      let sx
      let sy
      let sw
      let sh
      if (full.__ai2hFromDisplayMedia) {
        const scaleX = full.width / Math.max(1, window.innerWidth)
        const scaleY = full.height / Math.max(1, window.innerHeight)
        sx = Math.round(rect.x * scaleX)
        sy = Math.round(rect.y * scaleY)
        sw = Math.round(rect.width * scaleX)
        sh = Math.round(rect.height * scaleY)
      } else {
        sx = Math.round((rect.x + window.scrollX) * scale)
        sy = Math.round((rect.y + window.scrollY) * scale)
        sw = Math.round(rect.width * scale)
        sh = Math.round(rect.height * scale)
      }

      sw = Math.min(sw, full.width - sx)
      sh = Math.min(sh, full.height - sy)
      if (sw < 4 || sh < 4) throw new Error('La zone sélectionnée est trop petite')

      const crop = document.createElement('canvas')
      crop.width = sw
      crop.height = sh
      const ctx = crop.getContext('2d')
      if (!ctx) throw new Error('Impossible de créer le canevas de capture')
      ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh)

      const blob = await new Promise((resolve) => crop.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Impossible d’exporter la capture')
      addImageFiles([
        new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' }),
      ])
    } catch (error) {
      if (error && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Échec de la capture d’écran'
      state.createError = message.includes('oklch')
        ? 'La capture a échoué à cause du CSS de cette page. Essayez « Importer des fichiers ».'
        : message
    } finally {
      if (root) root.style.visibility = ''
      state.capturing = false
      state.open = true
      state.tab = 'create'
      render()
    }
  }

  function svgIcon(paths, attrs = {}) {
    const ns = 'http://www.w3.org/2000/svg'
    const node = document.createElementNS(ns, 'svg')
    node.setAttribute('viewBox', '0 0 24 24')
    node.setAttribute('fill', 'none')
    node.setAttribute('stroke', 'currentColor')
    node.setAttribute('stroke-width', '2.2')
    node.setAttribute('stroke-linecap', 'round')
    node.setAttribute('stroke-linejoin', 'round')
    node.setAttribute('aria-hidden', 'true')
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value))
    }
    for (const d of paths) {
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', d)
      node.append(path)
    }
    return node
  }

  function renderScreenshotField() {
    const fileInput = el('input', {
      id: 'ai2h-intake-files',
      className: 'ai2h-intake-file-input',
      type: 'file',
      accept: 'image/*',
      multiple: 'true',
      onChange: onFilesSelected,
    })

    const previews =
      state.files.length === 0
        ? el('p', {
            className: 'ai2h-intake-shot-empty',
            text: 'Aucune capture pour le moment',
          })
        : el(
            'div',
            { className: 'ai2h-intake-previews' },
            state.files.map((entry) =>
              el('div', { className: 'ai2h-intake-preview' }, [
                el('img', { src: entry.previewUrl, alt: entry.file.name }),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'ai2h-intake-preview__remove',
                    'aria-label': 'Supprimer la capture',
                    title: 'Supprimer',
                    onClick: () => removeFile(entry.id),
                  },
                  [
                    svgIcon(['M18 6 6 18', 'm6 6 12 12']),
                  ]
                ),
              ])
            )
          )

    return el('div', { className: 'ai2h-intake-field' }, [
      el('label', { text: 'Captures d’écran' }),
      el(
        'div',
        {
          className: 'ai2h-intake-shot',
          onDragover: (event) => {
            event.preventDefault()
            event.currentTarget.classList.add('is-dragover')
          },
          onDragleave: (event) => {
            event.currentTarget.classList.remove('is-dragover')
          },
          onDrop: (event) => {
            event.preventDefault()
            event.currentTarget.classList.remove('is-dragover')
            addImageFiles(event.dataTransfer && event.dataTransfer.files)
          },
        },
        [
          el('p', {
            className: 'ai2h-intake-shot__title',
            text: 'Ajouter une preuve visuelle',
          }),
          el('p', {
            className: 'ai2h-intake-shot__hint',
            text: 'Capturez une zone de cette page, ou importez des images',
          }),
          el('div', { className: 'ai2h-intake-shot__actions' }, [
            el('button', {
              type: 'button',
              className: 'ai2h-intake-btn ai2h-intake-btn--secondary',
              text: 'Capturer une zone',
              onClick: (event) => {
                event.preventDefault()
                captureRegion()
              },
            }),
            el('button', {
              type: 'button',
              className: 'ai2h-intake-btn ai2h-intake-btn--secondary',
              text: 'Importer des fichiers',
              onClick: (event) => {
                event.preventDefault()
                fileInput.click()
              },
            }),
          ]),
          fileInput,
          previews,
        ]
      ),
    ])
  }

  function renderCreateStepKind() {
    const options = [
      {
        kind: 'feature',
        title: 'Fonctionnalité',
        hint: 'Une idée, une amélioration, un besoin produit',
      },
      {
        kind: 'bug',
        title: 'Bug',
        hint: 'Quelque chose ne fonctionne pas comme prévu',
      },
      {
        kind: 'ui',
        title: 'Interface',
        hint: 'Un ajustement de design, d’ergonomie ou de texte',
      },
      {
        kind: 'unknown',
        title: 'Je ne sais pas',
        hint: 'Pas sûr · on tranchera plus tard',
      },
    ].filter((option) =>
      option.kind === 'unknown'
        ? allowedCategories().length > 1
        : allowedCategories().includes(option.kind)
    )

    return el('div', { className: 'ai2h-intake-step' }, [
      el('p', {
        className: 'ai2h-intake-step__eyebrow',
        text: 'Étape 1 sur 2',
      }),
      el('h3', {
        className: 'ai2h-intake-step__title',
        text: 'De quel type d’intake s’agit-il ?',
      }),
      el('p', {
        className: 'ai2h-intake-step__lead',
        text: 'Choisissez une option pour continuer.',
      }),
      el(
        'div',
        { className: 'ai2h-intake-kind-grid', role: 'group', 'aria-label': 'Type d’intake' },
        options.map((option) =>
          el('button', {
            type: 'button',
            className: `ai2h-intake-kind${state.kind === option.kind ? ' is-selected' : ''}`,
            onClick: () => selectKind(option.kind),
          }, [
            el('span', { className: 'ai2h-intake-kind__title', text: option.title }),
            el('span', { className: 'ai2h-intake-kind__hint', text: option.hint }),
          ])
        )
      ),
    ])
  }

  function renderCreateStepDetails() {
    const kindLabel =
      state.kind === 'bug'
        ? 'Bug'
        : state.kind === 'ui'
          ? 'Interface'
          : state.kind === 'unknown'
            ? 'Je ne sais pas'
            : 'Fonctionnalité'

    const singleCategory = allowedCategories().length === 1

    return el('div', { className: 'ai2h-intake-step' }, [
      el('div', { className: 'ai2h-intake-step__bar' }, [
        singleCategory ? null : el('button', {
          type: 'button',
          className: 'ai2h-intake-back',
          text: '← Type',
                          onClick: () => {
                            state.createStep = 1
                            state.createError = ''
                            saveMemory()
                            render()
                          },
        }),
        el('p', {
          className: 'ai2h-intake-step__eyebrow',
          text: singleCategory ? kindLabel : 'Étape 2 sur 2 · ' + kindLabel,
        }),
      ]),
      el('h3', {
        className: 'ai2h-intake-step__title',
        text: 'Décrivez et illustrez',
      }),
      el('p', {
        className: 'ai2h-intake-step__lead',
        text: 'Plus c’est clair, plus on avance vite.',
      }),
      el('form', { className: 'ai2h-intake-create-form', onSubmit: submitCreate }, [
        el('div', { className: 'ai2h-intake-field' }, [
          el('label', { text: 'Détails', for: 'ai2h-intake-body' }),
          el('textarea', {
            id: 'ai2h-intake-body',
            name: 'body',
            required: 'true',
            placeholder: 'Que faut-il faire ou corriger ?',
            value: state.bodyDraft,
            onInput: (event) => {
              state.bodyDraft = event.currentTarget.value
              saveMemory()
            },
          }),
        ]),
        renderScreenshotField(),
        state.createError
          ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.createError })
          : null,
        state.createOk
          ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.createOk })
          : null,
        el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--publish' }, [
          el('button', {
            className: 'ai2h-intake-btn ai2h-intake-btn--primary ai2h-intake-btn--block',
            type: 'submit',
            text: state.submitting ? 'Publication…' : 'Publier',
            disabled: state.submitting ? 'true' : undefined,
          }),
        ]),
      ]),
    ])
  }

  function renderCreateAccess() {
    if (state.categories === null && state.authzError) {
      return el('div', { className: 'ai2h-intake-step' }, [
        el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.authzError }),
        el('div', { className: 'ai2h-intake-actions' }, [
          el('button', {
            type: 'button',
            className: 'ai2h-intake-btn ai2h-intake-btn--secondary',
            text: 'Réessayer',
            onClick: () => loadAuthorization(),
          }),
        ]),
      ])
    }
    if (state.categories === null) {
      return el('p', { className: 'ai2h-intake-empty', text: 'Chargement…' })
    }
    return el('p', {
      className: 'ai2h-intake-empty',
      text: 'Votre compte n’est autorisé sur aucun type d’intake.',
    })
  }

  function renderCreatePanel() {
    const canCreate = allowedCategories().length > 0
    return el('div', { className: `ai2h-intake-panel${state.tab === 'create' ? ' is-active' : ''}` }, [
      !canCreate
        ? renderCreateAccess()
        : state.createStep === 1
          ? renderCreateStepKind()
          : renderCreateStepDetails(),
    ])
  }

  const STATUS_LABELS = {
    received: 'reçu',
    unclear: 'à clarifier',
    scoped: 'scopé',
    qualified: 'qualifié',
    completed: 'complété',
    failed: 'échec',
    archived: 'archivé',
  }

  const SCOPE_STATUS_LABELS = {
    open: 'en attente',
    processing: 'en cours',
    closed: 'fermé',
  }

  const SCOPE_PIPELINE_LABELS = {
    specifying: 'spécification',
    specified: 'spécifié',
    planning: 'planification',
    planned: 'planifié',
    opening_pr: 'ouverture PR',
    guardrailing: 'garde-fou',
    guardrailed: 'garde-fou',
    tasking: 'tâches',
    tasked: 'tâches',
    implementing: 'implémentation',
    implemented: 'implémenté',
  }

  const BUG_PIPELINE_LABELS = {
    assessing: 'diagnostic',
    assessed: 'diagnostiqué',
    fixing: 'correction',
    fixed: 'corrigé',
    testing: 'tests',
    tested: 'testé',
  }

  const UI_PIPELINE_LABELS = {
    implementing: 'implémentation',
    implemented: 'implémenté',
  }

  const CATEGORY_OPTION_LABELS = {
    feature: 'Fonctionnalité',
    bug: 'Bug',
    ui: 'Interface',
  }

  const CATEGORY_LABELS = {
    feature: 'fonctionnalité',
    bug: 'bug',
    ui: 'interface',
  }

  function pipelineStepLabel(item) {
    if (item.intake_category === 'bug' && item.intake_bug_pipeline_status) {
      return (
        BUG_PIPELINE_LABELS[item.intake_bug_pipeline_status] || item.intake_bug_pipeline_status
      )
    }
    if (item.intake_category === 'ui' && item.intake_bug_pipeline_status) {
      return (
        UI_PIPELINE_LABELS[item.intake_bug_pipeline_status] || item.intake_bug_pipeline_status
      )
    }
    const scope = item.scope
    if (!scope || !scope.scope_pipeline_status) return null
    if (item.intake_status !== 'scoped' && item.intake_status !== 'completed') return null
    return (
      SCOPE_PIPELINE_LABELS[scope.scope_pipeline_status] || scope.scope_pipeline_status
    )
  }

  function statusDisplay(item) {
    if (item.intake_status === 'completed' || item.intake_status === 'failed') {
      return STATUS_LABELS[item.intake_status]
    }

    const step = pipelineStepLabel(item)
    if (step) return `en cours · ${step}`

    const scope = item.scope
    if (scope && (item.intake_status === 'scoped' || item.intake_scope_id)) {
      const scopeLabel =
        SCOPE_STATUS_LABELS[scope.scope_status] || scope.scope_status || null
      if (scopeLabel) return `scopé · ${scopeLabel}`
    }

    return STATUS_LABELS[item.intake_status] || item.intake_status
  }

  // Agent's closing note: what it did (e.g. changes made in Orbiit OS) or why it failed.
  function renderAgentNote(item) {
    const note = typeof item.intake_agent_note === 'string' ? item.intake_agent_note.trim() : ''
    if (!note) return null
    const failed = item.intake_status === 'failed'
    return el(
      'div',
      { className: `ai2h-intake-item__note${failed ? ' ai2h-intake-item__note--failed' : ''}` },
      [
        el('strong', {
          className: 'ai2h-intake-item__note-label',
          text: failed ? 'Pourquoi ça a échoué' : 'Ce qui a été fait',
        }),
        el('p', { className: 'ai2h-intake-item__note-text', text: note }),
      ]
    )
  }

  function renderClarifyPanel() {
    const items = unclearIntakes()
    return el('div', { className: `ai2h-intake-panel${state.tab === 'clarify' ? ' is-active' : ''}` }, [
      el('p', {
        className: 'ai2h-intake-step__lead',
        text: 'Ces intakes ont besoin d’un complément pour être requalifiés.',
      }),
      state.clarifyError
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.clarifyError })
        : null,
      state.clarifyOk
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.clarifyOk })
        : null,
      state.archiveError && state.tab === 'clarify'
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.archiveError })
        : null,
      state.archiveOk && state.tab === 'clarify'
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.archiveOk })
        : null,
      state.loadingList
        ? el('p', { className: 'ai2h-intake-empty', text: 'Chargement…' })
        : items.length === 0
          ? el('p', { className: 'ai2h-intake-empty', text: 'Rien à clarifier pour le moment' })
          : el(
              'div',
              { className: 'ai2h-intake-list' },
              items.map((item) => {
                const expanded = state.expandedClarifyId === item.intake_id
                const busy = state.clarifyingId === item.intake_id
                const archiveBtn = renderArchiveButton(item)
                return el('article', { className: `ai2h-intake-item${expanded ? ' is-expanded' : ''}` }, [
                  el('h3', { className: 'ai2h-intake-item__title', text: item.intake_title }),
                  el('div', { className: 'ai2h-intake-item__meta' }, [
                    el('span', {
                      className: `ai2h-intake-status${item.intake_status === 'failed' ? ' ai2h-intake-status--failed' : ''}`,
                      text: statusDisplay(item),
                    }),
                    el('span', {
                      text:
                        CATEGORY_LABELS[item.intake_category] ||
                        item.intake_category ||
                        'sans catégorie',
                    }),
                    el('span', { text: formatDate(item.intake_created_at) }),
                  ]),
                  item.intake_body
                    ? el('p', { className: 'ai2h-intake-item__body', text: item.intake_body })
                    : null,
                  expanded
                    ? el('div', { className: 'ai2h-intake-clarify' }, [
                        allowedCategories().length < 2 ? null : el('div', { className: 'ai2h-intake-field' }, [
                          el('label', {
                            text: 'Catégorie (si vous la connaissez)',
                            for: `ai2h-clarify-cat-${item.intake_id}`,
                          }),
                          el(
                            'select',
                            {
                              id: `ai2h-clarify-cat-${item.intake_id}`,
                              value: state.clarifyCategories[item.intake_id] || '',
                              onChange: (event) => {
                                state.clarifyCategories[item.intake_id] = event.currentTarget.value
                                saveMemory()
                              },
                            },
                            [
                              el('option', { value: '', text: 'Ne pas modifier' }),
                              ...allowedCategories().map((category) =>
                                el('option', { value: category, text: CATEGORY_OPTION_LABELS[category] })
                              ),
                            ]
                          ),
                        ]),
                        el('div', { className: 'ai2h-intake-field' }, [
                          el('label', {
                            text: 'Complément',
                            for: `ai2h-clarify-body-${item.intake_id}`,
                          }),
                          el('textarea', {
                            id: `ai2h-clarify-body-${item.intake_id}`,
                            placeholder: 'Ajoutez le contexte manquant…',
                            value: state.clarifyDrafts[item.intake_id] || '',
                            onInput: (event) => {
                              state.clarifyDrafts[item.intake_id] = event.currentTarget.value
                              saveMemory()
                            },
                          }),
                        ]),
                        el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                          archiveBtn,
                          el('button', {
                            type: 'button',
                            className: 'ai2h-intake-btn ai2h-intake-btn--primary ai2h-intake-btn--grow',
                            text: busy ? 'Envoi…' : 'Envoyer le complément',
                            disabled: busy ? 'true' : undefined,
                            onClick: () => submitClarify(item),
                          }),
                        ]),
                      ])
                    : el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                        archiveBtn,
                        el('button', {
                          type: 'button',
                          className: 'ai2h-intake-btn ai2h-intake-btn--secondary ai2h-intake-btn--grow',
                          text: 'Compléter',
                          onClick: () => {
                            state.expandedClarifyId = item.intake_id
                            state.clarifyError = ''
                            state.clarifyOk = ''
                            state.archiveError = ''
                            state.archiveOk = ''
                            saveMemory()
                            render()
                          },
                        }),
                      ]),
                ])
              })
            ),
    ])
  }

  function renderVerifyPanel() {
    const items = toVerifyIntakes()
    return el('div', { className: `ai2h-intake-panel${state.tab === 'verify' ? ' is-active' : ''}` }, [
      el('p', {
        className: 'ai2h-intake-step__lead',
        text: 'Intakes complétés en attente de votre validation.',
      }),
      state.verifyError
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.verifyError })
        : null,
      state.verifyOk
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.verifyOk })
        : null,
      state.archiveError && state.tab === 'verify'
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.archiveError })
        : null,
      state.archiveOk && state.tab === 'verify'
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.archiveOk })
        : null,
      state.loadingList
        ? el('p', { className: 'ai2h-intake-empty', text: 'Chargement…' })
        : items.length === 0
          ? el('p', { className: 'ai2h-intake-empty', text: 'Rien à vérifier pour le moment' })
          : el(
              'div',
              { className: 'ai2h-intake-list' },
              items.map((item) => {
                const expanded = state.expandedListId === item.intake_id
                const busy = state.verifyingId === item.intake_id
                const files = Array.isArray(item.files) ? item.files : []
                const archiveBtn = renderArchiveButton(item)
                const verifyBtn = el('button', {
                  type: 'button',
                  className: 'ai2h-intake-btn ai2h-intake-btn--primary ai2h-intake-btn--grow',
                  text: busy ? 'Vérification…' : 'Vérifié',
                  disabled: busy || state.verifyingId ? 'true' : undefined,
                  onClick: (event) => {
                    event.preventDefault()
                    submitVerify(item)
                  },
                })
                return el('article', { className: `ai2h-intake-item${expanded ? ' is-expanded' : ''}` }, [
                  el('h3', { className: 'ai2h-intake-item__title', text: item.intake_title }),
                  el('div', { className: 'ai2h-intake-item__meta' }, [
                    el('span', {
                      className: `ai2h-intake-status${item.intake_status === 'failed' ? ' ai2h-intake-status--failed' : ''}`,
                      text: statusDisplay(item),
                    }),
                    el('span', {
                      text:
                        CATEGORY_LABELS[item.intake_category] ||
                        item.intake_category ||
                        'sans catégorie',
                    }),
                    el('span', { text: formatDate(item.intake_created_at) }),
                  ]),
                  item.intake_body
                    ? el('p', { className: 'ai2h-intake-item__body', text: item.intake_body })
                    : null,
                  renderAgentNote(item),
                  expanded && files.length > 0
                    ? el(
                        'div',
                        { className: 'ai2h-intake-previews' },
                        files.map((file) =>
                          el(
                            'a',
                            {
                              className: 'ai2h-intake-preview',
                              href: file.intake_file_url,
                              target: '_blank',
                              rel: 'noreferrer',
                              title: file.intake_file_original_filename || 'Capture',
                            },
                            [
                              el('img', {
                                src: file.intake_file_url,
                                alt: file.intake_file_original_filename || 'Capture d’écran',
                              }),
                            ]
                          )
                        )
                      )
                    : null,
                  el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                    archiveBtn,
                    expanded
                      ? el('button', {
                          type: 'button',
                          className: 'ai2h-intake-btn ai2h-intake-btn--secondary',
                          text: 'Réduire',
                          onClick: () => {
                            state.expandedListId = null
                            saveMemory()
                            render()
                          },
                        })
                      : files.length > 0
                        ? el('button', {
                            type: 'button',
                            className: 'ai2h-intake-btn ai2h-intake-btn--secondary',
                            text: 'Voir captures',
                            onClick: () => {
                              state.expandedListId = item.intake_id
                              state.verifyError = ''
                              state.verifyOk = ''
                              state.archiveError = ''
                              state.archiveOk = ''
                              saveMemory()
                              render()
                            },
                          })
                        : null,
                    verifyBtn,
                  ]),
                ])
              })
            ),
    ])
  }

  function renderListPanel() {
    const items = filteredIntakes()
    const total = state.listTotal
    const counts = state.statusCounts || {}
    return el('div', { className: `ai2h-intake-panel${state.tab === 'list' ? ' is-active' : ''}` }, [
      el('div', { className: 'ai2h-intake-field' }, [
        el('label', { text: 'Recherche', for: 'ai2h-intake-search' }),
        el('input', {
          id: 'ai2h-intake-search',
          type: 'search',
          value: state.search,
          placeholder: 'Filtrer par titre ou détails',
          onInput: (event) => {
            state.search = event.currentTarget.value
            saveMemory()
            render()
          },
        }),
      ]),
      el(
        'div',
        { className: 'ai2h-intake-filters' },
        [
          el('button', {
            type: 'button',
            className: `ai2h-intake-chip${!state.statusFilter ? ' is-active' : ''}`,
            text: `Tous (${total})`,
            onClick: () => {
              state.statusFilter = ''
              saveMemory()
              render()
            },
          }),
          ...STATUSES.map((status) =>
            el('button', {
              type: 'button',
              className: `ai2h-intake-chip${state.statusFilter === status ? ' is-active' : ''}`,
              text: `${STATUS_LABELS[status] || status} (${counts[status] || 0})`,
              onClick: () => {
                state.statusFilter = status
                saveMemory()
                render()
              },
            })
          ),
        ]
      ),
      state.listError
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.listError })
        : null,
      state.archiveError
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: state.archiveError })
        : null,
      state.archiveOk
        ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: state.archiveOk })
        : null,
      state.loadingList
        ? el('p', { className: 'ai2h-intake-empty', text: 'Chargement…' })
        : items.length === 0
          ? el('p', { className: 'ai2h-intake-empty', text: 'Aucun intake trouvé' })
          : el(
              'div',
              { className: 'ai2h-intake-list' },
              items.map((item) => {
                const expanded = state.expandedListId === item.intake_id
                const files = Array.isArray(item.files) ? item.files : []
                const archiveBtn = renderArchiveButton(item)
                return el('article', { className: `ai2h-intake-item${expanded ? ' is-expanded' : ''}` }, [
                  el('h3', { className: 'ai2h-intake-item__title', text: item.intake_title }),
                  el('div', { className: 'ai2h-intake-item__meta' }, [
                    el('span', {
                      className: `ai2h-intake-status${item.intake_status === 'failed' ? ' ai2h-intake-status--failed' : ''}`,
                      text: statusDisplay(item),
                    }),
                    el('span', {
                      text:
                        CATEGORY_LABELS[item.intake_category] ||
                        item.intake_category ||
                        'sans catégorie',
                    }),
                    el('span', { text: formatDate(item.intake_created_at) }),
                  ]),
                  expanded
                    ? item.intake_body
                      ? el('p', { className: 'ai2h-intake-item__body', text: item.intake_body })
                      : el('p', {
                          className: 'ai2h-intake-item__body ai2h-intake-item__body--empty',
                          text: 'Aucun détail',
                        })
                    : null,
                  expanded || item.intake_status === 'failed' ? renderAgentNote(item) : null,
                  expanded && files.length > 0
                    ? el(
                        'div',
                        { className: 'ai2h-intake-previews' },
                        files.map((file) =>
                          el(
                            'a',
                            {
                              className: 'ai2h-intake-preview',
                              href: file.intake_file_url,
                              target: '_blank',
                              rel: 'noreferrer',
                              title: file.intake_file_original_filename || 'Capture',
                            },
                            [
                              el('img', {
                                src: file.intake_file_url,
                                alt: file.intake_file_original_filename || 'Capture d’écran',
                              }),
                            ]
                          )
                        )
                      )
                    : null,
                  expanded
                    ? el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                        archiveBtn,
                        el('button', {
                          type: 'button',
                          className: 'ai2h-intake-btn ai2h-intake-btn--secondary ai2h-intake-btn--grow',
                          text: 'Réduire',
                          onClick: () => {
                            state.expandedListId = null
                            saveMemory()
                            render()
                          },
                        }),
                      ])
                    : el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                        archiveBtn,
                        el('button', {
                          type: 'button',
                          className: 'ai2h-intake-btn ai2h-intake-btn--secondary ai2h-intake-btn--grow',
                          text: 'Voir détails',
                          onClick: () => {
                            state.expandedListId = item.intake_id
                            state.archiveError = ''
                            state.archiveOk = ''
                            saveMemory()
                            render()
                          },
                        }),
                      ]),
                ])
              })
            ),
    ])
  }

  function renderLoginPanel() {
    const auth = state.auth
    const isCode = auth.step === 'code'

    const input = isCode
      ? el('input', {
          id: 'ai2h-intake-auth-input',
          name: 'code',
          type: 'text',
          inputmode: 'numeric',
          autocomplete: 'one-time-code',
          pattern: '\\d{6}',
          maxlength: '6',
          required: 'true',
          placeholder: '123456',
          value: auth.code,
          onInput: (event) => {
            auth.code = event.currentTarget.value
          },
        })
      : el('input', {
          id: 'ai2h-intake-auth-input',
          name: 'email',
          type: 'email',
          autocomplete: 'email',
          required: 'true',
          placeholder: 'vous@exemple.com',
          value: auth.email,
          onInput: (event) => {
            auth.email = event.currentTarget.value
          },
        })

    return el('div', { className: 'ai2h-intake-panel is-active' }, [
      el('div', { className: 'ai2h-intake-step' }, [
        el('h3', {
          className: 'ai2h-intake-step__title',
          text: isCode ? 'Entrez le code reçu' : 'Accès propriétaire',
        }),
        el('p', {
          className: 'ai2h-intake-step__lead',
          text: isCode
            ? `Code envoyé à ${auth.email.trim()}. Il expire dans 10 minutes.`
            : 'Recevez un code de connexion par email. La session dure 2 heures.',
        }),
        el(
          'form',
          {
            className: 'ai2h-intake-create-form',
            onSubmit: isCode ? submitVerifyOtp : submitRequestOtp,
          },
          [
            el('div', { className: 'ai2h-intake-field' }, [
              el('label', {
                text: isCode ? 'Code à 6 chiffres' : 'Email',
                for: 'ai2h-intake-auth-input',
              }),
              input,
            ]),
            auth.error
              ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--error', text: auth.error })
              : null,
            auth.info
              ? el('p', { className: 'ai2h-intake-message ai2h-intake-message--ok', text: auth.info })
              : null,
            el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--publish' }, [
              el('button', {
                className: 'ai2h-intake-btn ai2h-intake-btn--primary ai2h-intake-btn--block',
                type: 'submit',
                text: auth.busy
                  ? isCode
                    ? 'Vérification…'
                    : 'Envoi…'
                  : isCode
                    ? 'Se connecter'
                    : 'Recevoir un code',
                disabled: auth.busy ? 'true' : undefined,
              }),
            ]),
            isCode
              ? el('div', { className: 'ai2h-intake-actions ai2h-intake-actions--row' }, [
                  el('button', {
                    type: 'button',
                    className: 'ai2h-intake-btn ai2h-intake-btn--secondary ai2h-intake-btn--grow',
                    text: 'Changer d’email',
                    disabled: auth.busy ? 'true' : undefined,
                    onClick: () => {
                      auth.step = 'email'
                      auth.code = ''
                      auth.error = ''
                      auth.info = ''
                      render()
                      focusAuthInput()
                    },
                  }),
                  el('button', {
                    type: 'button',
                    className: 'ai2h-intake-btn ai2h-intake-btn--secondary ai2h-intake-btn--grow',
                    text: 'Renvoyer le code',
                    disabled: auth.busy ? 'true' : undefined,
                    onClick: () => submitRequestOtp(),
                  }),
                ])
              : null,
          ]
        ),
      ]),
    ])
  }

  function renderTabs() {
    return el('div', { className: 'ai2h-intake-tabs' }, [
      el('button', {
        type: 'button',
        className: `ai2h-intake-tab${state.tab === 'create' ? ' is-active' : ''}`,
        text: 'Créer',
        onClick: () => {
          state.tab = 'create'
          if (!state.kind) state.createStep = 1
          saveMemory()
          render()
        },
      }),
      el('button', {
        type: 'button',
        className: `ai2h-intake-tab${state.tab === 'clarify' ? ' is-active' : ''}`,
        text: `À clarifier (${unclearCount()})`,
        onClick: () => {
          state.tab = 'clarify'
          state.clarifyError = ''
          saveMemory()
          loadIntakes()
        },
      }),
      el('button', {
        type: 'button',
        className: `ai2h-intake-tab${state.tab === 'verify' ? ' is-active' : ''}`,
        text: `À vérifier (${toVerifyCount()})`,
        onClick: () => {
          state.tab = 'verify'
          state.verifyError = ''
          state.verifyOk = ''
          saveMemory()
          loadIntakes()
        },
      }),
      el('button', {
        type: 'button',
        className: `ai2h-intake-tab${state.tab === 'list' ? ' is-active' : ''}`,
        text: `Liste (${state.listTotal})`,
        onClick: () => {
          state.tab = 'list'
          saveMemory()
          loadIntakes()
        },
      }),
    ])
  }

  function render(options = {}) {
    if (state.capturing) {
      const existing = document.getElementById('ai2h-intake-root')
      if (existing) existing.replaceChildren()
      return
    }

    let root = document.getElementById('ai2h-intake-root')
    if (!state.revealed) {
      if (root) {
        root.hidden = true
        root.replaceChildren()
      }
      return
    }

    const animateOpen = Boolean(options.animateOpen)
    const showOpen = state.open && !animateOpen && !state.closing
    const loginRequired = needsLogin()

    if (!root) {
      root = el('div', { id: 'ai2h-intake-root' })
      document.body.append(root)
    }
    root.hidden = false
    root.replaceChildren()

    const backdrop = el('div', {
      className: `ai2h-intake-backdrop${showOpen ? ' is-open' : ''}`,
      onClick: closeDrawer,
    })
    const drawer = el(
      'aside',
      {
        id: 'ai2h-intake-drawer',
        className: `ai2h-intake-drawer${showOpen ? ' is-open' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Intake',
      },
      [
        el('div', { className: 'ai2h-intake-drawer__header' }, [
          el('h2', { className: 'ai2h-intake-drawer__title', text: 'Intake' }),
          otpEnabled && !loginRequired
            ? el('button', {
                type: 'button',
                className: 'ai2h-intake-logout',
                text: 'Déconnexion',
                onClick: logout,
              })
            : null,
          el('button', {
            type: 'button',
            className: 'ai2h-intake-close',
            text: '×',
            'aria-label': 'Fermer',
            onClick: closeDrawer,
          }),
        ]),
        ...(loginRequired
          ? [renderLoginPanel()]
          : [
              renderTabs(),
              renderCreatePanel(),
              renderClarifyPanel(),
              renderVerifyPanel(),
              renderListPanel(),
            ]),
      ]
    )

    root.append(
      el(
        'button',
        {
          type: 'button',
          className: 'ai2h-intake-toggle',
          'aria-expanded': state.open ? 'true' : 'false',
          'aria-controls': 'ai2h-intake-drawer',
          onClick: () => (state.open ? closeDrawer() : openDrawer()),
        },
        [
          el('span', {
            className: 'ai2h-intake-toggle__icon',
            text: '+',
            'aria-hidden': 'true',
          }),
          el('span', { className: 'ai2h-intake-toggle__label', text: 'INTAKE' }),
        ]
      ),
      backdrop,
      drawer
    )

    if (animateOpen && state.open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          backdrop.classList.add('is-open')
          drawer.classList.add('is-open')
        })
      })
    }
  }

  const REVEAL_SEQUENCE_TIMEOUT_MS = 1500
  let typedSequence = ''
  let typedAt = 0

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  }

  function matchesRevealSequence(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false
    if (isTypingTarget(event.target)) return false

    const now = Date.now()
    if (now - typedAt > REVEAL_SEQUENCE_TIMEOUT_MS) typedSequence = ''
    typedAt = now
    typedSequence = (typedSequence + event.key.toLowerCase()).slice(-revealSequence.length)
    if (typedSequence !== revealSequence) return false

    typedSequence = ''
    return true
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      closeDrawer()
      return
    }
    if (revealRequired && !state.capturing && matchesRevealSequence(event)) {
      toggleFromShortcut()
    }
  })

  // View transitions replace <body>, which drops the drawer root.
  document.addEventListener('astro:after-swap', () => render())

  loadMemory()

  async function boot() {
    await loadFilesMemory()
    render()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}
