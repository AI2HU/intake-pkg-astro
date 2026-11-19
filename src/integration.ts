import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import type { AstroIntegration } from 'astro'
import type { IntakeDrawerConfig, IntakeOptions, IntakeServerConfig } from './types.ts'

const PACKAGE_NAME = '@ai2h/astro-intake'
const DEFAULT_BASE_URL = 'https://intake.ai2h.tech'
const DEFAULT_ROUTE_PREFIX = '/__intake'
const DEFAULT_SHORTCUT = 'intake'

const BROWSER_MODULE = 'virtual:ai2h-intake/browser'
const SERVER_MODULE = 'virtual:ai2h-intake/server'

/** Same precedence as Vite: `.env` < `.env.local` < `.env.[mode]` < `.env.[mode].local` < process env. */
function loadIntakeEnv(root: string, mode: string) {
  const env: Record<string, string> = {}
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    let contents: string
    try {
      contents = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    for (const [key, value] of Object.entries(parseEnv(contents))) {
      if (key.startsWith('INTAKE_') && value !== undefined) env[key] = value
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('INTAKE_') && value !== undefined) env[key] = value
  }
  return env
}

function normalizePrefix(prefix: string | undefined) {
  const value = (prefix ?? DEFAULT_ROUTE_PREFIX).trim().replace(/\/+$/, '')
  if (!value) return DEFAULT_ROUTE_PREFIX
  return value.startsWith('/') ? value : `/${value}`
}

function resolveShortcut(shortcut: IntakeOptions['shortcut'], otp: boolean) {
  if (shortcut === false) return null
  if (shortcut === undefined) return otp ? DEFAULT_SHORTCUT : null
  const value = shortcut.trim().toLowerCase()
  if (!value) {
    throw new Error(`[${PACKAGE_NAME}] "shortcut" must be a non-empty string or false`)
  }
  return value
}

export default function intake(options: IntakeOptions = {}): AstroIntegration {
  return {
    name: PACKAGE_NAME,
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, injectRoute, injectScript, logger }) => {
        const isDev = command === 'dev'
        const env = loadIntakeEnv(fileURLToPath(config.root), isDev ? 'development' : 'production')

        const otp = options.otp ?? true
        const proxy = options.proxy ?? false
        const inject = options.inject ?? true
        const shortcut = resolveShortcut(options.shortcut, otp)
        const routePrefix = normalizePrefix(options.routePrefix)
        const baseUrl = (options.baseUrl || env.INTAKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
        const projectId = options.projectId || env.INTAKE_PROJECT_ID || ''
        // Only inline the key in dev; production reads INTAKE_API_KEY at runtime.
        const apiKey = options.apiKey ?? (isDev ? env.INTAKE_API_KEY || '' : '')

        if (!otp && !proxy) {
          throw new Error(
            `[${PACKAGE_NAME}] "otp: false" requires "proxy: true": the project API key must stay on the server`
          )
        }

        if (!options.baseUrl && !env.INTAKE_BASE_URL) {
          logger.warn(`INTAKE_BASE_URL is not set; using ${DEFAULT_BASE_URL}`)
        }
        if (!projectId) {
          logger.warn('INTAKE_PROJECT_ID is not set; Intake API calls will fail until it is configured')
        }
        if (proxy && !otp && isDev && !apiKey) {
          logger.warn('INTAKE_API_KEY is not set; Intake API calls will fail until it is configured')
        }
        if (!proxy) {
          logger.info(
            `Direct mode: the browser calls ${baseUrl}; add this site origin to its CORS_ORIGINS`
          )
        }

        const drawerConfig: IntakeDrawerConfig = {
          mode: proxy ? 'proxy' : 'direct',
          apiBase: proxy ? routePrefix : `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}`,
          otp,
          shortcut,
        }
        const serverConfig: IntakeServerConfig = { baseUrl, projectId, apiKey, otp }

        updateConfig({
          vite: {
            plugins: [
              {
                name: `${PACKAGE_NAME}:config`,
                resolveId(id: string) {
                  if (id === BROWSER_MODULE || id === SERVER_MODULE) return `\0${id}`
                },
                load(id: string) {
                  if (id === `\0${BROWSER_MODULE}`) {
                    return `export default ${JSON.stringify(drawerConfig)}`
                  }
                  if (id === `\0${SERVER_MODULE}`) {
                    if (this.environment?.config.consumer === 'client') {
                      this.error(`${SERVER_MODULE} is server-only and cannot be imported in the browser`)
                    }
                    return `export default ${JSON.stringify(serverConfig)}`
                  }
                },
              },
            ],
            optimizeDeps: { exclude: [PACKAGE_NAME] },
            ssr: { noExternal: [PACKAGE_NAME] },
          },
        })

        if (proxy) {
          injectRoute({
            pattern: `${routePrefix}/[...path]`,
            entrypoint: `${PACKAGE_NAME}/proxy`,
            prerender: false,
          })
        }

        if (inject) {
          injectScript('page', `import '${PACKAGE_NAME}/drawer'`)
        }
      },
    },
  }
}
