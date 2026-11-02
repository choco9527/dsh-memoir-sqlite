import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

// Exercise the actual client entry without replacing its slot components or writing lib/.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
})
type Snapshot = { current?: string; byId: Record<string, { cwd?: string; retainedBy?: { mainView?: number } }> }
type ViewProps = { sessionId?: string; useSessions: (select: (snapshot: Snapshot) => string) => string; close: () => void }
type PanelProps = { cwd: string; openSource: (sessionId: string, turnId?: number) => void }
type Element = { type: (props: ViewProps) => { props: { children: { props: PanelProps } } }; props: ViewProps }
type Slot = (props: ViewProps) => Element

async function harness(t: TestContext, mode: 'legacy' | 'current' | 'both' | 'missing' | 'failing') {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>')
  const slots = new Map<string, Slot>()
  const disposers: Array<() => void> = []
  t.after(() => { for (const dispose of disposers.reverse()) dispose(); dom.window.close() })
  const calls: string[] = []
  let settingsRegistrations = 0
  let ready!: () => void
  const mounted = new Promise<void>(resolve => { ready = resolve })
  const ctx = {
    sessions: mode === 'legacy' || mode === 'both' ? { open(id: string) { calls.push(`legacy:${id}`) } } : {},
    get(name: string) {
      if (name === 'sessions') return ctx.sessions
      return name === 'uiWorkspace' && ['current', 'both', 'failing'].includes(mode)
        ? { openSession(id: string) { if (mode === 'failing') throw new Error('navigation failed'); calls.push(`current:${id}`) } }
        : undefined
    },
    effect(run: () => () => void) { const dispose = run(); disposers.push(dispose); return dispose },
    slots: {
      inject(_name: string, register: () => () => void) { return register() },
      register(options: { name: string }, component: Slot) {
        slots.set(options.name, component)
        if (options.name === 'settings.section' && ++settingsRegistrations === 2) ready()
        return () => { if (slots.get(options.name) === component) slots.delete(options.name) }
      },
    },
  }
  const module = { exports: { apply(_ctx: typeof ctx) {} } }
  runInNewContext(compiled.outputFiles[0]!.text, {
    module, exports: module.exports, document: dom.window.document, MutationObserver: dom.window.MutationObserver,
    require(name: string) {
      // Preserve element props and execute the real slot components without mounting the full panel.
      if (name === 'react') return { useEffect() {} }
      if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }) }
      throw new Error(`Unexpected platform import: ${name}`)
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { showConversationView: true } }) }),
  })
  module.exports.apply(ctx)
  await mounted
  return {
    calls,
    panel(name: string, snapshot: Snapshot, sessionId?: string): PanelProps {
      const slot = slots.get(name)
      assert.ok(slot)
      const view = slot({ sessionId, useSessions: select => select(snapshot), close() { calls.push('close') } })
      return view.type(view.props).props.children.props
    },
  }
}

test('rc.1 Settings follows main-view retention instead of a removed current field', async (t) => {
  const app = await harness(t, 'current')
  const first = { byId: { a: { cwd: '/a', retainedBy: { mainView: 1 } }, b: { cwd: '/b', retainedBy: {} } } }
  assert.equal(app.panel('settings.section', first).cwd, '/a')
  const switched = { byId: { a: { cwd: '/a', retainedBy: {} }, b: { cwd: '/b', retainedBy: { mainView: 1 } } } }
  assert.equal(app.panel('settings.section', switched).cwd, '/b')
  assert.equal(app.panel('settings.section', { ...switched, current: 'a' }).cwd, '/b', 'retention wins over stale legacy selection')
  assert.equal(app.panel('settings.section', { byId: { a: { cwd: '/a', retainedBy: {} } } }).cwd, '')
})

test('rc.1 source links use UI navigation from both native slots', async (t) => {
  const app = await harness(t, 'current')
  const snapshot = { byId: { a: { cwd: '/a', retainedBy: { mainView: 1 } } } }
  app.panel('settings.section', snapshot).openSource('source')
  app.panel('conversation.view', snapshot, 'a').openSource('other')
  assert.deepEqual(app.calls, ['current:source', 'close', 'current:other'])
})

test('legacy alpha Settings and source links retain the older navigation API', async (t) => {
  const app = await harness(t, 'legacy')
  const snapshot = { current: 'a', byId: { a: { cwd: '/a' } } }
  assert.equal(app.panel('settings.section', snapshot).cwd, '/a')
  app.panel('settings.section', snapshot).openSource('source')
  app.panel('conversation.view', snapshot, 'a').openSource('other')
  assert.deepEqual(app.calls, ['legacy:source', 'close', 'legacy:other'])
})

test('conversation view remains tied to its explicit session, not the main view', async (t) => {
  const app = await harness(t, 'current')
  const snapshot = { byId: { a: { cwd: '/a', retainedBy: { mainView: 1 } }, b: { cwd: '/b', retainedBy: {} } } }
  assert.equal(app.panel('conversation.view', snapshot, 'b').cwd, '/b')
})

test('UI navigation takes priority when both API generations are provided', async (t) => {
  const app = await harness(t, 'both')
  app.panel('settings.section', { byId: {} }).openSource('source')
  assert.deepEqual(app.calls, ['current:source', 'close'])
})

test('missing or failing navigation does not close the memory panel', async (t) => {
  const missing = await harness(t, 'missing')
  assert.throws(() => missing.panel('settings.section', { byId: {} }).openSource('source'), /navigation is unavailable/)
  assert.deepEqual(missing.calls, [])
  const failing = await harness(t, 'failing')
  assert.throws(() => failing.panel('settings.section', { byId: {} }).openSource('source'), /navigation failed/)
  assert.deepEqual(failing.calls, [])
})
