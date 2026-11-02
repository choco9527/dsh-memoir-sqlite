/** Regression cases for the upstream 0.9.3 budget fixes with Argo's section policy. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, renderHotMemory, selectHotMemory, truncateEntryToBudget } from '../lib/selector.js'
import type { MemoirEntry } from '../lib/store.js'

const NOW = 1_700_000_000_000

for (const language of ['zh', 'en'] as const) {
  test(`${language}: skip an oversized middle entry and retain the next fitting memory`, () => {
    const entries: MemoirEntry[] = [
      { id: 'first', section: 'actions', content: '先检查输入', time: NOW },
      { id: 'large', section: 'actions', content: '长'.repeat(1000), time: NOW - 1 },
      { id: 'last', section: 'lessons', content: '保留原文', time: NOW - 2 },
    ]
    const original = structuredClone(entries)
    const result = selectHotMemory(entries, { targetTokens: 80, hardMaxTokens: 80 }, NOW, language)
    assert.deepEqual(result.selected.map(entry => entry.id), ['first', 'last'])
    assert.equal(result.total, 3)
    assert.ok(result.estimatedTokens <= 80)
    assert.deepEqual(entries, original)
  })

  test(`${language}: long titles and content fit the complete rendered budget`, () => {
    const entry: MemoirEntry = {
      id: 'long', section: 'lessons', title: '长标题𠮷'.repeat(100), content: '正文𠮷'.repeat(1000), time: NOW,
    }
    const original = structuredClone(entry)
    for (const hardMaxTokens of [1, 8, 20, 50, 100, 500]) {
      const result = selectHotMemory([entry], { targetTokens: hardMaxTokens, hardMaxTokens }, NOW, language)
      assert.ok(result.estimatedTokens <= hardMaxTokens)
      assert.equal(result.estimatedTokens, estimateTokens(result.text))
      assert.doesNotMatch(result.text, /[\uD800-\uDFFF]/u, 'truncation preserves whole Unicode code points')
      if (result.selected.length > 0) assert.match(result.text, /…/)
    }
    assert.deepEqual(entry, original)
  })

  test(`${language}: an impossible budget yields no selected memory`, () => {
    const entry: MemoirEntry = { id: 'tiny', section: 'actions', title: '标题', content: '正文', time: NOW }
    assert.equal(truncateEntryToBudget(entry, 1, language), undefined)
    const result = selectHotMemory([entry], { targetTokens: 1, hardMaxTokens: 1 }, NOW, language)
    assert.deepEqual(result, { text: '', selected: [], total: 1, estimatedTokens: 0 })
  })

  test(`${language}: preserve a fitting title while shortening only the body`, () => {
    const entry: MemoirEntry = { id: 'body', section: 'actions', title: '规则', content: '长'.repeat(1000), time: NOW }
    const result = truncateEntryToBudget(entry, 50, language)
    assert.ok(result)
    assert.equal(result.title, entry.title)
    assert.ok(result.content.endsWith('…'))
    assert.ok(estimateTokens(renderHotMemory([result], language)) <= 50)
  })
}
