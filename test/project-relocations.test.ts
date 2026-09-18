import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MemoirStore } from '../lib/store.js'
import { projectPathResolver } from '../lib/project-path.js'
import { makeRoutes } from '../lib/routes.js'
import { callRoute, makeTempWorkspace } from './helpers.ts'

test('project responses expose the relocated path before and after recording memory', async () => {
  const temp = makeTempWorkspace()
  const from = join(temp.dir, 'removed-workspace')
  const to = join(temp.dir, 'argo-workspace')
  mkdirSync(to)
  const store = new MemoirStore(join(temp.dir, 'memory.db'), { pathRelocations: [{ from, to }] })
  try {
    const handler = makeRoutes(store)[0]!.handler
    for (const populated of [false, true]) {
      if (populated) store.record(from, { section: 'note', content: 'retained memory' })
      const response = await callRoute(handler, { url: '/api/dsh-memoir/project?path=' + encodeURIComponent(from) })
      assert.equal(response.status, 200)
      const { project } = response.envelope.value as { project: { path: string; entries: unknown[] } }
      assert.equal(project.path, to)
      assert.equal(project.entries.length, populated ? 1 : 0)
    }
    assert.equal(existsSync(from), false)
  } finally { store.close(); temp.cleanup() }
})

test('old and new workspace paths share memories without a legacy directory or symlink', () => {
  const temp = makeTempWorkspace()
  const from = join(temp.dir, 'old-workspace')
  const to = join(temp.dir, 'new-workspace')
  const db = join(temp.dir, 'memory.db')
  mkdirSync(from); mkdirSync(to)
  const old = new MemoirStore(db)
  const first = old.record(from, { section: 'lessons', content: 'old memory', pinned: true }, { sessionId: 'original', turnId: 2 })
  const second = old.record(to, { section: 'note', content: 'new memory' })
  old.close()
  renameSync(from, from + '-backup')
  const options = { pathRelocations: [{ from, to }] }
  const store = new MemoirStore(db, options)
  try {
    assert.deepEqual(store.entries(from), store.entries(to))
    assert.deepEqual(store.entries(to).map(entry => entry.id), [first.id, second.id])
    assert.deepEqual(store.entries(to)[0], first)
    assert.equal(store.listProjects().length, 1)
    assert.equal(store.project(from)?.path, to)
    const raw = new DatabaseSync(db, { readOnly: true })
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM projects').get()?.n, 2, 'read compatibility does not rewrite the database')
    raw.close()
    store.update(from, first.id, { title: 'retained' })
    const third = store.record(from, { section: 'note', content: 'after move' })
    assert.equal(existsSync(from), false, 'writes never recreate the old directory')
    assert.equal(existsSync(join(to, 'PROJECT_MEMORY.md')), true)
    assert.equal(store.entries(to).length, 3)
    assert.equal(store.entries(to)[0]?.source?.sessionId, 'original')
    assert.equal(store.remove(to, third.id), true)
  } finally { store.close() }
  const reopened = new MemoirStore(db, options)
  try {
    assert.equal(reopened.entries(from).length, 2)
    assert.equal(reopened.entries(to)[0]?.id, first.id)
    assert.equal(reopened.entries(to)[0]?.version, 2)
    const raw = new DatabaseSync(db, { readOnly: true })
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM projects').get()?.n, 1)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM entry_revisions WHERE entry_id = ? AND operation = 'insert'").get(first.id)?.n, 1)
    raw.close()
  } finally { reopened.close(); temp.cleanup() }
})

test('path mappings use full directory boundaries, longest prefixes and Windows casing', () => {
  const resolve = projectPathResolver([{ from: '/old', to: '/new' }, { from: '/old/outputs', to: '/artifacts' }])
  assert.equal(resolve('/old/outputs/a'), '/artifacts/a')
  assert.equal(resolve('/old/project'), '/new/project')
  assert.equal(resolve('/older/project'), '/older/project')
  const windows = projectPathResolver([{ from: 'C:\\Users\\Me\\Old', to: 'C:\\Users\\Me\\Argo' }])
  assert.equal(windows('c:/users/me/old/child'), 'C:\\Users\\Me\\Argo/child')
  assert.equal(windows('c:/users/me/older'), 'c:/users/me/older')
})

test('invalid, duplicate and cyclic mappings fail before opening a database', () => {
  for (const mappings of [
    [{ from: '/', to: '/new' }], [{ from: 'relative', to: '/new' }],
    [{ from: '/old', to: '/old/child' }],
    [{ from: '/old', to: '/new' }, { from: '/old', to: '/other' }],
    [{ from: '/old', to: '/new' }, { from: '/new', to: '/old' }],
  ]) assert.throws(() => projectPathResolver(mappings))
})
