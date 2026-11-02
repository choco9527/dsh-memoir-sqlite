import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Narrow versioned faces keep the client compatible with both published API generations. */
interface WorkspaceNavigation {
  openSession?: (sessionId: SessionId) => void
}

interface LegacySessionNavigation {
  open?: (sessionId: SessionId) => void
}

/**
 * Open a source through the UI navigation owner; alpha keeps that operation on sessions.
 * @param ctx - client context whose manifest loads the workspace UI package.
 * @param sessionId - trusted source-session identity recorded by the Host.
 */
export function openSourceSession(ctx: Context, sessionId: SessionId): void {
  const workspace: WorkspaceNavigation | undefined = ctx.get('uiWorkspace')
  if (typeof workspace?.openSession === 'function') {
    workspace.openSession(sessionId)
    return
  }
  const legacy = ctx.get('sessions') as LegacySessionNavigation | undefined
  if (typeof legacy?.open === 'function') {
    legacy.open(sessionId)
    return
  }
  throw new Error('Memoir source-session navigation is unavailable')
}
