import { IntakeApiError, type IntakeClient } from './client.ts'
import type {
  CreateIntakeInput,
  IntakeCategory,
  IntakeClientContext,
  IntakeRequestAuth,
  IntakeStatus,
} from './types.ts'

const SESSION_HEADER = 'x-intake-session'

const CATEGORIES: readonly IntakeCategory[] = ['feature', 'bug', 'ui']

type RequestInput = {
  get(key: string): unknown
  files: File[]
}

function isCategory(value: string): value is IntakeCategory {
  return (CATEGORIES as readonly string[]).includes(value)
}

function json(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status })
  return Response.json(body, { status })
}

function parseClientContext(raw: unknown): IntakeClientContext | undefined {
  if (raw == null || raw === '') return undefined
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as IntakeClientContext
  }
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as IntakeClientContext
    }
  } catch {
    return undefined
  }
  return undefined
}

async function readInput(request: Request): Promise<RequestInput> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    const form = await request.formData()
    return {
      get: (key) => {
        const value = form.get(key)
        return typeof value === 'string' ? value : undefined
      },
      files: form.getAll('files').filter((value): value is File => typeof value !== 'string'),
    }
  }

  if (contentType.includes('application/json')) {
    const data: unknown = await request.json().catch(() => null)
    const record =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {}
    return { get: (key) => record[key], files: [] }
  }

  return { get: () => undefined, files: [] }
}

export class IntakeController {
  #client: IntakeClient
  #otp: boolean

  constructor(client: IntakeClient, otp: boolean) {
    this.#client = client
    this.#otp = otp
  }

  /**
   * In OTP mode the browser session is mandatory and the project API key is never used.
   * Returns a 401 response when the session header is missing.
   */
  #auth(request: Request): IntakeRequestAuth | Response {
    if (!this.#otp) return {}
    const token = String(request.headers.get(SESSION_HEADER) ?? '').trim()
    if (!token) {
      return json(401, { error: 'Session Intake requise' })
    }
    return { sessionToken: token }
  }

  async #forward(run: () => Promise<Response>): Promise<Response> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof IntakeApiError && error.statusCode >= 400 && error.statusCode < 500) {
        return json(error.statusCode, { error: error.detail })
      }
      throw error
    }
  }

  async requestOtp(request: Request) {
    const input = await readInput(request)
    const email = String(input.get('email') ?? '').trim()
    if (!email) {
      return json(422, { error: 'l’email est obligatoire' })
    }
    return this.#forward(async () => {
      await this.#client.requestOtp(email)
      return json(200, { status: 'ok' })
    })
  }

  async verifyOtp(request: Request) {
    const input = await readInput(request)
    const email = String(input.get('email') ?? '').trim()
    const code = String(input.get('code') ?? '').trim()
    if (!email || !/^\d{6}$/.test(code)) {
      return json(422, { error: 'email et code à 6 chiffres obligatoires' })
    }
    return this.#forward(async () => {
      const session = await this.#client.verifyOtp(email, code)
      return json(200, session)
    })
  }

  async logout(request: Request) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth
    const sessionToken = auth.sessionToken
    if (!sessionToken) return json(401, { error: 'Session Intake requise' })
    return this.#forward(async () => {
      await this.#client.logout(sessionToken)
      return json(204)
    })
  }

  async authorization(request: Request) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth
    return this.#forward(async () => json(200, await this.#client.getAuthorization(auth)))
  }

  async list(request: Request, url: URL) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth

    const status = (url.searchParams.get('intake_status') || undefined) as IntakeStatus | undefined
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)

    return this.#forward(async () => {
      const result = await this.#client.listIntakes(
        {
          status,
          limit: Number.isFinite(limit) ? limit : 50,
          offset: Number.isFinite(offset) ? offset : 0,
        },
        auth
      )
      return json(200, result)
    })
  }

  async create(request: Request) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth

    const input = await readInput(request)
    const titleRaw = input.get('title')
    const title = typeof titleRaw === 'string' ? titleRaw.trim() : ''
    const category = String(input.get('category') ?? '').trim()
    const body = String(input.get('body') ?? '').trim()
    const clientContext = parseClientContext(input.get('client_context'))
    const labelsRaw = input.get('labels')
    let labels: string[] | undefined
    if (typeof labelsRaw === 'string' && labelsRaw.trim()) {
      try {
        const parsed = JSON.parse(labelsRaw)
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          labels = parsed
        }
      } catch {
        labels = undefined
      }
    } else if (Array.isArray(labelsRaw) && labelsRaw.every((item) => typeof item === 'string')) {
      labels = labelsRaw
    }

    if (!body || !isCategory(category)) {
      return json(422, {
        error: 'le corps et la catégorie (feature|bug|ui) sont obligatoires',
      })
    }

    const files: NonNullable<CreateIntakeInput['files']> = []
    for (const file of input.files) {
      if (file.size <= 0) continue
      files.push({
        data: file,
        filename: file.name || 'screenshot.png',
        contentType: file.type || undefined,
      })
    }

    return this.#forward(async () => {
      const intake = await this.#client.createIntake(
        {
          title,
          category,
          body,
          labels,
          clientContext,
          files: files.length ? files : undefined,
        },
        auth
      )
      return json(201, intake)
    })
  }

  async update(request: Request, intakeId: string) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth

    if (!intakeId) {
      return json(422, { error: 'intake_id est requis' })
    }

    const input = await readInput(request)
    const bodyRaw = input.get('body')
    const categoryRaw = String(input.get('category') ?? '').trim()
    const titleRaw = input.get('title')
    const verifiedAtRaw = input.get('verified_at')

    const payload: {
      title?: string
      body?: string
      category?: IntakeCategory
      verifiedAt?: string | null
    } = {}

    if (typeof bodyRaw === 'string') {
      const body = bodyRaw.trim()
      if (!body) {
        return json(422, { error: 'les détails sont obligatoires' })
      }
      payload.body = body
    }

    if (isCategory(categoryRaw)) {
      payload.category = categoryRaw
    }

    if (typeof titleRaw === 'string' && titleRaw.trim()) {
      payload.title = titleRaw.trim()
    }

    if (verifiedAtRaw !== undefined) {
      if (verifiedAtRaw === null || verifiedAtRaw === '') {
        payload.verifiedAt = null
      } else if (typeof verifiedAtRaw === 'string') {
        payload.verifiedAt = verifiedAtRaw
      } else {
        return json(422, { error: 'verified_at doit être une date ISO ou null' })
      }
    }

    if (
      payload.body === undefined &&
      payload.category === undefined &&
      payload.title === undefined &&
      payload.verifiedAt === undefined
    ) {
      return json(422, {
        error: 'indiquez des détails, une catégorie et/ou verified_at',
      })
    }

    return this.#forward(async () => {
      const intake = await this.#client.updateIntake(intakeId, payload, auth)
      return json(200, intake)
    })
  }

  async archive(request: Request, intakeId: string) {
    const auth = this.#auth(request)
    if (auth instanceof Response) return auth

    if (!intakeId) {
      return json(422, { error: 'intake_id est requis' })
    }

    return this.#forward(async () => {
      const intake = await this.#client.archiveIntake(intakeId, auth)
      return json(200, intake)
    })
  }

  notFound() {
    return json(404, { error: 'Ressource introuvable' })
  }
}
