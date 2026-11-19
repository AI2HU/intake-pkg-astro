import type {
  BrowserSessionCreated,
  CreateIntakeInput,
  IntakeAuthorization,
  IntakeConfig,
  IntakeListResponse,
  IntakeRead,
  IntakeRequestAuth,
  ListIntakesInput,
  UpdateIntakeInput,
} from './types.ts'

export class IntakeApiError extends Error {
  constructor(
    public statusCode: number,
    public detail: string
  ) {
    super(`Intake API ${statusCode}: ${detail}`)
    this.name = 'IntakeApiError'
  }
}

export class IntakeClient {
  #config: IntakeConfig

  constructor(config: IntakeConfig) {
    this.#config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, '') }
  }

  get config() {
    return this.#config
  }

  /**
   * Categories the caller may use. A browser session is limited to its contact's categories;
   * the project API key gets every category.
   */
  async getAuthorization(auth: IntakeRequestAuth = {}): Promise<IntakeAuthorization> {
    const path = `/v1/projects/${this.#config.projectId}/authorization`
    return this.#request<IntakeAuthorization>(path, { method: 'GET' }, auth)
  }

  async listIntakes(
    input: ListIntakesInput = {},
    auth: IntakeRequestAuth = {}
  ): Promise<IntakeListResponse> {
    const params = new URLSearchParams()
    if (input.status) params.set('intake_status', input.status)
    if (input.source) params.set('intake_source', input.source)
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    if (input.offset !== undefined) params.set('offset', String(input.offset))

    const query = params.toString()
    const path = `/v1/projects/${this.#config.projectId}/intakes${query ? `?${query}` : ''}`
    return this.#request<IntakeListResponse>(path, { method: 'GET' }, auth)
  }

  async createIntake(input: CreateIntakeInput, auth: IntakeRequestAuth = {}): Promise<IntakeRead> {
    const path = `/v1/projects/${this.#config.projectId}/intakes`
    const hasFiles = Boolean(input.files?.length)
    const title = input.title ?? ''
    const body = input.body
    const clientContextJson = input.clientContext
      ? JSON.stringify(input.clientContext)
      : undefined

    if (hasFiles) {
      const form = new FormData()
      form.set('title', title)
      form.set('category', input.category)
      form.set('body', body)
      if (input.labels) form.set('labels', JSON.stringify(input.labels))
      if (input.linkedIntakeId) form.set('linked_intake_id', input.linkedIntakeId)
      if (input.imageUrls?.length) form.set('image_urls', JSON.stringify(input.imageUrls))
      if (clientContextJson) form.set('client_context', clientContextJson)

      for (const file of input.files ?? []) {
        const type = file.contentType || 'application/octet-stream'
        const blob =
          file.data instanceof Blob ? file.data : new Blob([Uint8Array.from(file.data)], { type })
        form.append('files', blob, file.filename)
      }

      return this.#request<IntakeRead>(path, { method: 'POST', body: form }, auth)
    }

    return this.#request<IntakeRead>(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: input.category,
          body,
          labels: input.labels ?? [],
          linked_intake_id: input.linkedIntakeId ?? null,
          image_urls: input.imageUrls ?? [],
          client_context: input.clientContext ?? null,
        }),
      },
      auth
    )
  }

  async updateIntake(
    intakeId: string,
    input: UpdateIntakeInput,
    auth: IntakeRequestAuth = {}
  ): Promise<IntakeRead> {
    const path = `/v1/projects/${this.#config.projectId}/intakes/${intakeId}`
    const body: Record<string, unknown> = {}
    if (input.title !== undefined) body.title = input.title
    if (input.body !== undefined) body.body = input.body
    if (input.category !== undefined) body.category = input.category
    if (input.labels !== undefined) body.labels = input.labels
    if (input.linkedIntakeId !== undefined) body.linked_intake_id = input.linkedIntakeId
    if (input.imageUrls !== undefined) body.image_urls = input.imageUrls
    if (input.verifiedAt !== undefined) body.verified_at = input.verifiedAt

    return this.#request<IntakeRead>(
      path,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      auth
    )
  }

  async archiveIntake(intakeId: string, auth: IntakeRequestAuth = {}): Promise<IntakeRead> {
    const path = `/v1/projects/${this.#config.projectId}/intakes/${intakeId}/archive`
    return this.#request<IntakeRead>(path, { method: 'POST' }, auth)
  }

  async requestOtp(email: string): Promise<void> {
    await this.#browserAuth('request-otp', { method: 'POST', json: { email } })
  }

  async verifyOtp(email: string, code: string): Promise<BrowserSessionCreated> {
    return this.#browserAuth<BrowserSessionCreated>('verify-otp', {
      method: 'POST',
      json: { email, code },
    })
  }

  async logout(sessionToken: string): Promise<void> {
    await this.#browserAuth('logout', { method: 'POST', sessionToken })
  }

  async #browserAuth<T>(
    action: string,
    options: { method: string; json?: unknown; sessionToken?: string }
  ): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' })
    if (options.json !== undefined) headers.set('Content-Type', 'application/json')
    if (options.sessionToken) headers.set('Authorization', `Bearer ${options.sessionToken}`)

    return this.#send<T>(`/v1/projects/${this.#config.projectId}/browser-auth/${action}`, {
      method: options.method,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    })
  }

  async #request<T>(path: string, init: RequestInit, auth: IntakeRequestAuth): Promise<T> {
    const headers = new Headers(init.headers)
    if (auth.sessionToken) {
      headers.set('Authorization', `Bearer ${auth.sessionToken}`)
    } else {
      headers.set('X-Api-Key', this.#config.apiKey)
    }
    headers.set('Accept', 'application/json')
    return this.#send<T>(path, { ...init, headers })
  }

  async #send<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.#config.baseUrl}${path}`, init)

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload && 'detail' in payload
          ? JSON.stringify((payload as { detail: unknown }).detail)
          : text || response.statusText
      throw new IntakeApiError(response.status, detail)
    }

    return payload as T
  }
}
