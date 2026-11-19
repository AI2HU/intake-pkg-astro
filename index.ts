import intake from './src/integration.ts'

export default intake
export { IntakeApiError, IntakeClient } from './src/client.ts'
export type {
  BrowserSessionCreated,
  IntakeAuthorization,
  IntakeCategory,
  IntakeConfig,
  IntakeDrawerConfig,
  IntakeFileRead,
  IntakeListResponse,
  IntakeOptions,
  IntakeRead,
  IntakeRequestAuth,
  IntakeScopeSummary,
  IntakeServerConfig,
  IntakeStatus,
} from './src/types.ts'
