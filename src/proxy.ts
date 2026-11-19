import type { APIRoute } from 'astro'
import { IntakeController } from './controller.ts'
import { getIntakeClient, getIntakeConfig } from './server.ts'

export const prerender = false

let controller: IntakeController | undefined

function getController() {
  controller ??= new IntakeController(getIntakeClient(), getIntakeConfig().otp)
  return controller
}

export const ALL: APIRoute = async ({ params, request, url }) => {
  const ctrl = getController()
  const segments = String(params.path ?? '')
    .split('/')
    .filter(Boolean)
  const [resource, id = '', action] = segments
  const method = request.method.toUpperCase()

  if (resource === 'authorization' && segments.length === 1 && method === 'GET') {
    return ctrl.authorization(request)
  }

  if (resource === 'intakes') {
    if (segments.length === 1 && method === 'GET') return ctrl.list(request, url)
    if (segments.length === 1 && method === 'POST') return ctrl.create(request)
    if (segments.length === 2 && method === 'PATCH') return ctrl.update(request, id.trim())
    if (segments.length === 3 && action === 'archive' && method === 'POST') {
      return ctrl.archive(request, id.trim())
    }
  }

  if (resource === 'browser-auth' && segments.length === 2 && method === 'POST' && getIntakeConfig().otp) {
    if (id === 'request-otp') return ctrl.requestOtp(request)
    if (id === 'verify-otp') return ctrl.verifyOtp(request)
    if (id === 'logout') return ctrl.logout(request)
  }

  return ctrl.notFound()
}
