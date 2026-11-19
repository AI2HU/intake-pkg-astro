export type IntakeCategory = 'feature' | 'bug' | 'ui'

export type IntakeStatus =
  | 'received'
  | 'unclear'
  | 'qualified'
  | 'scoped'
  | 'completed'
  | 'failed'
  | 'archived'

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ConsoleLogEntry = {
  level: ConsoleLogLevel
  message: string
  timestamp?: string
}

export type IntakeClientContext = {
  user_agent?: string | null
  page_url?: string | null
  console_logs?: ConsoleLogEntry[]
}

export type IntakeFileRead = {
  intake_file_id: string
  intake_file_url: string
  intake_file_original_filename: string | null
  intake_file_content_type: string | null
}

export type IntakeScopeSummary = {
  scope_id: string
  scope_status: 'open' | 'processing' | 'closed' | string
  scope_pipeline_status: string | null
  scope_pr_url: string | null
}

export type IntakeRead = {
  intake_id: string
  intake_project_id: string
  intake_source: string
  intake_title: string
  intake_body: string
  intake_labels: string[]
  intake_category: IntakeCategory | null
  intake_status: IntakeStatus
  intake_scope_id: string | null
  intake_linked_intake_id: string | null
  intake_bug_pipeline_status: string | null
  intake_pr_url: string | null
  intake_agent_retry_count: number
  /** Agent's closing note: what it did (e.g. Orbiit OS changes) or why it failed. */
  intake_agent_note: string | null
  intake_verified_at: string | null
  intake_created_at: string
  intake_updated_at: string
  files: IntakeFileRead[]
  client_context?: IntakeClientContext | null
  /** Nested when `intake_scope_id` is set (from list/get intakes). */
  scope: IntakeScopeSummary | null
}

export type IntakeListResponse = {
  items: IntakeRead[]
  total: number
  limit: number
  offset: number
}

export type IntakeOptions = {
  /** Intake API base URL. Defaults to `INTAKE_BASE_URL`, then `https://intake.ai2h.tech`. */
  baseUrl?: string
  /** Intake project id. Defaults to `INTAKE_PROJECT_ID`. */
  projectId?: string
  /**
   * Project API key (`itk_...`), proxy mode with `otp: false` only.
   * Prefer the `INTAKE_API_KEY` runtime env var so the key is not inlined in the build.
   */
  apiKey?: string
  /** Owners unlock the drawer with an email OTP (default `true`). */
  otp?: boolean
  /**
   * Serve the Intake API through on-demand routes under `routePrefix` (needs an adapter).
   * When `false` (default) the drawer calls the Intake API directly, which works on static sites
   * but requires `otp: true` and the site origin in the Intake `CORS_ORIGINS`.
   */
  proxy?: boolean
  /** Proxy routes prefix (default `/__intake`). */
  routePrefix?: string
  /**
   * Key sequence that shows/hides the drawer. `false` keeps the toggle button always visible.
   * Defaults to `'intake'` when `otp` is on, `false` otherwise.
   */
  shortcut?: string | false
  /** Add the drawer to every page (default `true`). Set `false` and use `<IntakeDrawer />` instead. */
  inject?: boolean
}

export type IntakeConfig = {
  baseUrl: string
  apiKey: string
  projectId: string
}

export type IntakeServerConfig = IntakeConfig & {
  otp: boolean
}

export type IntakeDrawerConfig = {
  mode: 'direct' | 'proxy'
  /** `{baseUrl}/v1/projects/{projectId}` in direct mode, `routePrefix` in proxy mode. */
  apiBase: string
  otp: boolean
  shortcut: string | null
}

/** What the caller may do on the project's intakes (`GET /v1/projects/{id}/authorization`). */
export type IntakeAuthorization = {
  /** Categories the caller may create, list, update and archive. Canonical order: feature, bug, ui. */
  categories: IntakeCategory[]
  /** Contact behind a browser session; `null` for the project API key. */
  contact: { email: string; name: string | null } | null
}

export type IntakeRequestAuth = {
  /** Browser session token (`its_…`). When set, it replaces the project API key. */
  sessionToken?: string
}

export type BrowserSessionCreated = {
  session_token: string
  expires_at: string
  project_id: string
}

export type CreateIntakeInput = {
  title?: string
  category: IntakeCategory
  body: string
  labels?: string[]
  linkedIntakeId?: string
  imageUrls?: string[]
  clientContext?: IntakeClientContext
  files?: Array<{
    data: Blob | Uint8Array
    filename: string
    contentType?: string
  }>
}

export type UpdateIntakeInput = {
  title?: string
  body?: string
  category?: IntakeCategory
  labels?: string[]
  linkedIntakeId?: string | null
  imageUrls?: string[]
  verifiedAt?: string | null
}

export type ListIntakesInput = {
  status?: IntakeStatus
  source?: 'api' | 'github'
  limit?: number
  offset?: number
}
