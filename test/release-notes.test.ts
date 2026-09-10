import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

test('release notes show Chinese by default and collapse English', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/render-release-notes.mjs'), '0.1.0'],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^## 中文\n/)
  assert.match(result.stdout, /Node 内置 `node:sqlite`/)
  assert.match(result.stdout, /中文 2\/3-gram BM25/)
  assert.match(result.stdout, /<details>\n<summary>English<\/summary>/)
  assert.match(result.stdout, /## English\n/)
  assert.match(result.stdout, /built-in `node:sqlite`/)
  assert.match(result.stdout, /CJK 2\/3-gram BM25/)
  assert.match(result.stdout, /github\.com\/choco9527\/dsh-memoir-sqlite\/blob\/v0\.1\.0\/CHANGELOG\.md/)
  assert.match(result.stdout, /npmjs\.com\/package\/dsh-memoir-sqlite\/v\/0\.1\.0/)
  assert.ok(result.stdout.indexOf('## 中文') < result.stdout.indexOf('<details>'))
  assert.ok(result.stdout.indexOf('<details>') < result.stdout.indexOf('## English'))
})
