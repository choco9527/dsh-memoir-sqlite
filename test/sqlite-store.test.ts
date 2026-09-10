/** SQLite persistence, audit, schema, and legacy-import coverage. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { statSync, writeFileSync } from 'node:fs'
import { MemoirStore } from '../lib/store.js'
import { DATABASE_SCHEMA_VERSION } from '../lib/sqlite-store.js'
import { makeTempStorePath, makeTempWorkspace } from './helpers.ts'

test('SQLite schema stores entry versions and appends an audit history', () => {
  const path = makeTempStorePath()
  const workspace = makeTempWorkspace()
  const store = new MemoirStore(path)
  try {
    const entry = store.record(workspace.cwd, {
      section: 'lessons',
      title: '库存校验',
      content: '提交奖品后重新读取 OMS 结果。',
      tags: ['oms', 'reward'],
    }, { sessionId: 'session-a', turnId: 2 })
    const updated = store.update(workspace.cwd, entry.id, { content: '提交后重新读取并核对 OMS 库存。' })
    assert.equal(updated?.version, 2)
    assert.equal(store.remove(workspace.cwd, entry.id), true)

    const database = new DatabaseSync(path, { readOnly: true })
    try {
      const schema = database.prepare('PRAGMA user_version').get() as { user_version: number }
      assert.equal(schema.user_version, DATABASE_SCHEMA_VERSION)
      const rows = database.prepare(`
        SELECT operation, version FROM entry_revisions WHERE entry_id = ? ORDER BY audit_id
      `).all(entry.id) as unknown as Array<{ operation: string; version: number }>
      const audit = rows.map((row) => ({ operation: row.operation, version: row.version }))
      assert.deepEqual(audit, [
        { operation: 'insert', version: 1 },
        { operation: 'update', version: 2 },
        { operation: 'delete', version: 2 },
      ])
    } finally {
      database.close()
    }
    assert.equal(statSync(path).mode & 0o777, 0o600)
  } finally {
    store.close()
    workspace.cleanup()
  }
})

test('configured legacy JSON is imported once into an empty database', () => {
  const path = makeTempStorePath()
  const legacyPath = path + '.json'
  writeFileSync(legacyPath, JSON.stringify({
    version: 4,
    projects: {
      '/workspace': {
        path: '/workspace',
        title: 'workspace',
        updatedAt: 100,
        entries: [{ id: 'legacy-entry', section: 'lessons', content: '保留中文经验', time: 100 }],
      },
    },
  }))
  const store = new MemoirStore(path, { legacyJsonPath: legacyPath })
  try {
    assert.equal(store.entries('/workspace')[0]?.content, '保留中文经验')
    store.invalidate()
    assert.equal(store.entries('/workspace').length, 1, 'the same legacy file is not imported twice')
  } finally {
    store.close()
  }
})

test('a newer SQLite schema fails loudly', () => {
  const path = makeTempStorePath()
  const database = new DatabaseSync(path)
  database.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION + 1}`)
  database.close()
  assert.throws(
    () => new MemoirStore(path),
    /database schema .* is newer than supported/,
  )
})
