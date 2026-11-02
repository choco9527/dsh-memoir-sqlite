/**
 * Workspace tracker: projects the client sessions service's active session
 * cwd into a useSyncExternalStore-compatible subscription. Pure logic — the
 * sessions service is injected, unit-testable with a mock.
 */

export interface SessionRecordLike {
  cwd?: string
  retainedBy?: { readonly mainView?: number }
}

/** Alpha exposes current; rc.1 marks the main view on its retained Session row. */
export interface SessionListLike {
  current?: string
  byId: Readonly<Record<string, SessionRecordLike>>
}

export interface SessionsLike {
  list: {
    getSnapshot(): SessionListLike
    subscribe(listener: () => void): () => void
  }
}

/** Resolve the main-view workspace without treating background retained Sessions as selected. */
export function readSessionCwd(snapshot: SessionListLike): string {
  const rows = Object.values(snapshot.byId)
  const current = rows.some(row => row.retainedBy !== undefined)
    ? rows.find(row => (row.retainedBy?.mainView ?? 0) > 0)
    : snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]
  const cwd = current?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : ''
}

/** Read the active session's cwd from a sessions service snapshot ('' when none). */
export function readCwd(sessions: SessionsLike): string {
  return readSessionCwd(sessions.list.getSnapshot())
}

/** A useSyncExternalStore-compatible tracker over the sessions service. */
export interface CwdTracker {
  getSnapshot(): string
  subscribe(listener: () => void): () => void
}

/**
 * Build a { getSnapshot, subscribe } tracker over the sessions service.
 * @param sessions - the client sessions service (with `list.getSnapshot` and
 *   `list.subscribe`).
 */
export function createCwdTracker(sessions: SessionsLike): CwdTracker {
  let current = readCwd(sessions)
  const listeners = new Set<() => void>()
  const tracker: CwdTracker = {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      const dispose = sessions.list.subscribe(() => {
        const next = readCwd(sessions)
        if (next === current) return
        current = next
        for (const l of [...listeners]) l()
      })
      return () => {
        listeners.delete(listener)
        dispose()
      }
    },
  }
  return tracker
}
