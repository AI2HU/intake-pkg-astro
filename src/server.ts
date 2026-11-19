import serverConfig from 'virtual:ai2h-intake/server'
import { IntakeApiError, IntakeClient } from './client.ts'
import type { IntakeServerConfig } from './types.ts'

export { IntakeApiError, IntakeClient }

let client: IntakeClient | undefined

/** Resolved integration config. The API key is read from `INTAKE_API_KEY` at runtime first. */
export function getIntakeConfig(): IntakeServerConfig {
  const runtimeApiKey = globalThis.process?.env?.INTAKE_API_KEY
  return { ...serverConfig, apiKey: runtimeApiKey || serverConfig.apiKey }
}

/** Shared server-side client, configured from the `intake()` integration options. */
export function getIntakeClient(): IntakeClient {
  client ??= new IntakeClient(getIntakeConfig())
  return client
}
