/**
 * Store cache tests (roadmap §2.1 acceptance):
 *   - 100 consecutive warm reads never re-read the database
 *   - record/remove keep the snapshot consistent with SQLite
 *   - revision bumps on writes
 *   - external commits are picked up by the data-version probe
 *   - corrupt databases are backed up (never silently overwritten)
 *   - atomic writes use unique temp names without leftovers
 *   - project keys normalize (C:\A / c:\a\ / C:/A → one bucket)
 *   - markdown render cache + skip-write behavior
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MemoirStore, PROJECT_FILE, writeFileAtomic } from '../lib/store.js'
import { makeTempStorePath, makeTempWorkspace } from './helpers.ts'

test('warm reads serve from the snapshot: 100 entries() → no database reread', () => {
  const ws = makeTempWorkspace()
  try {
    const store = new MemoirStore(makeTempStorePath(), { mtimeCheckIntervalMs: 0 })
    store.record(ws.cwd, { section: 'work', content: 'warm' })
    // Force a genuine cold load from the file we just wrote.
    store.invalidate()
    store.entries(ws.cwd)
    const before = store.stats()
    const reads = before.fileReads

    for (let i = 0; i < 100; i++) store.entries(ws.cwd)
    const after = store.stats()
    assert.equal(after.fileReads, reads, 'no re-read across 100 warm reads')
    assert.equal(after.loads, before.loads + 100)
    assert.equal(after.hits, before.hits + 100)
    assert.equal(after.misses, before.misses, 'no new misses across 100 warm reads')
    assert.equal(after.hitRate, after.hits / after.loads)
  } finally {
    ws.cleanup()
  }
})

test('record/remove bump the revision and keep snapshot === disk', () => {
  const ws = makeTempWorkspace()
  try {
    const path = makeTempStorePath()
    const store = new MemoirStore(path)
    const r0 = store.currentRevision()
    store.record(ws.cwd, { section: 'work', content: 'a' })
    assert.equal(store.currentRevision(), r0 + 1)
    store.record(ws.cwd, { section: 'work', content: 'b' })
    const afterWrites = store.currentRevision()
    assert.equal(afterWrites, r0 + 2)
    assert.deepEqual(new MemoirStore(path).load(), store.load())
    const entry = store.entries(ws.cwd)[0]
    assert.ok(entry)
    store.remove(ws.cwd, entry.id)
    assert.equal(store.currentRevision(), r0 + 3)
    assert.equal(store.entries(ws.cwd).length, 1)
    assert.deepEqual(new MemoirStore(path).load(), store.load())
  } finally {
    ws.cleanup()
  }
})

test('external SQLite commits are picked up by the data-version probe', () => {
  const ws = makeTempWorkspace()
  try {
    const path = makeTempStorePath()
    const store = new MemoirStore(path, { mtimeCheckIntervalMs: 0 })
    store.record(ws.cwd, { section: 'work', content: '本地' })
    const external = new MemoirStore(path, { mtimeCheckIntervalMs: 0 })
    external.record(ws.cwd, { section: 'lessons', content: '外部写入' })
    assert.equal(store.entries(ws.cwd).length, 2, 'external entry visible after mtime change')
    assert.equal(store.entries(ws.cwd)[1]?.content, '外部写入')
  } finally {
    ws.cleanup()
  }
})

test('empty initialized database is cached', () => {
  const store = new MemoirStore(makeTempStorePath(), { mtimeCheckIntervalMs: 0 })
  assert.equal(store.entries(String.raw`C:\x`).length, 0)
  const s1 = store.stats()
  assert.equal(s1.misses, 1)
  store.entries(String.raw`C:\x`)
  store.listProjects()
  const s2 = store.stats()
  assert.equal(s2.misses, 1, 'empty database snapshot is cached')
  assert.equal(s2.hits, s2.loads - 1)
})

test('corrupt store file is backed up and the store starts fresh', () => {
  const path = makeTempStorePath()
  writeFileSync(path, 'not json at all {{{')
  const store = new MemoirStore(path)
  assert.deepEqual(store.listProjects(), [])
  assert.equal(store.stats().corruptBackups, 1)
  assert.ok(existsSync(path), 'a fresh database replaces the preserved corrupt input')
  const base = basename(path)
  const backups = readdirSync(dirname(path)).filter((f) => f.startsWith(base + '.corrupt.'))
  assert.equal(backups.length, 1)
  // The next save writes a fresh file.
  const ws = makeTempWorkspace()
  try {
    store.record(ws.cwd, { section: 'work', content: 'recovered' })
    assert.equal(new MemoirStore(path).entries(ws.cwd).length, 1)
  } finally {
    ws.cleanup()
  }
})

test('invalid store shape is treated as corrupt and backed up', () => {
  const path = makeTempStorePath()
  writeFileSync(path, JSON.stringify({ version: 2, projects: 'oops' }))
  const store = new MemoirStore(path)
  assert.deepEqual(store.listProjects(), [])
  assert.equal(store.stats().corruptBackups, 1)
})

test('legacy windows key variants merge into one bucket', () => {
  const path = makeTempStorePath()
  const legacyPath = path + '.json'
  writeFileSync(legacyPath, JSON.stringify({
    version: 2,
    projects: {
      [String.raw`C:\proj`]: {
        path: String.raw`C:\proj`, title: 'proj', updatedAt: 2000,
        entries: [{ id: 'a', section: 'work', content: '甲', time: 1000 }],
      },
      'c:/proj': {
        path: 'c:/proj', title: 'proj', updatedAt: 3000,
        entries: [{ id: 'b', section: 'lessons', content: '乙', time: 2000 }],
      },
    },
  }))
  const store = new MemoirStore(path)
  store.importLegacyJson(legacyPath)
  assert.equal(store.listProjects().length, 1, 'one normalized bucket')
  const entries = store.entries(String.raw`C:\proj`)
  assert.equal(entries.length, 2, 'entries merged by id')
  assert.deepEqual(entries.map((e) => e.content), ['甲', '乙'])
})

test('writeFileAtomic uses unique temp names and leaves no temp files', () => {
  const ws = makeTempWorkspace()
  try {
    const target = join(ws.cwd, 'a.txt')
    writeFileAtomic(target, 'one')
    writeFileAtomic(target, 'two')
    assert.equal(readFileSync(target, 'utf8'), 'two')
    assert.deepEqual(readdirSync(ws.cwd), ['a.txt'], 'no tmp leftovers')
  } finally {
    ws.cleanup()
  }
})

test('renderMarkdown is cached until the project changes', () => {
  const ws = makeTempWorkspace()
  try {
    const store = new MemoirStore(makeTempStorePath(), { mtimeCheckIntervalMs: 0 })
    store.record(ws.cwd, { section: 'work', content: 'first' })
    const a = store.renderMarkdown(ws.cwd)
    const b = store.renderMarkdown(ws.cwd)
    assert.equal(a, b)
    // record() rendered once; a and b are cache hits.
    assert.equal(store.stats().renderComputes, 1)
    assert.equal(store.stats().renders, 3)
    assert.equal(store.stats().renderHitRate, 2 / 3)
    store.record(ws.cwd, { section: 'lessons', content: 'second' })
    const c = store.renderMarkdown(ws.cwd)
    assert.notEqual(c, a)
    assert.equal(store.stats().renderComputes, 2, 'mutation invalidates the render cache')
  } finally {
    ws.cleanup()
  }
})

test('writeProjectFile skips the write when content is unchanged', () => {
  const ws = makeTempWorkspace()
  try {
    const store = new MemoirStore(makeTempStorePath())
    store.record(ws.cwd, { section: 'work', content: '稳定' })
    const file = join(ws.cwd, PROJECT_FILE)
    const mtime1 = statSync(file).mtimeMs
    store.writeProjectFile(ws.cwd)
    const mtime2 = statSync(file).mtimeMs
    assert.equal(mtime1, mtime2, 'identical content is not rewritten (git-friendly)')
  } finally {
    ws.cleanup()
  }
})

test('invalidate forces the next load to re-read the file', () => {
  const ws = makeTempWorkspace()
  try {
    const store = new MemoirStore(makeTempStorePath())
    store.record(ws.cwd, { section: 'work', content: 'x' })
    const reads = store.stats().fileReads
    store.invalidate()
    store.entries(ws.cwd)
    assert.equal(store.stats().fileReads, reads + 1)
  } finally {
    ws.cleanup()
  }
})

test('SQLite data-version probes preserve an unchanged warm snapshot', () => {
  const path = makeTempStorePath()
  const store = new MemoirStore(path, { mtimeCheckIntervalMs: 0 })
  store.load()
  store.load()
  assert.equal(store.stats().fileReads, 1)
  assert.equal(store.stats().misses, 1)
  assert.equal(store.stats().hits, 1)
})
