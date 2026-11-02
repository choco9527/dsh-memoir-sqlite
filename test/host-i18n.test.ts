import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { distillPrompt } from '../lib/autodistill.js'
import { memoirGuidance, memoirSectionText } from '../lib/index.js'
import { hostCopy } from '../lib/i18n.js'
import { RetrievalEngine } from '../lib/retrieval.js'
import { selectHotMemory } from '../lib/selector.js'
import { MemoirStore, PROJECT_FILE } from '../lib/store.js'
import { memoirReadTool, memoirRecordTool, memoirUpdateTool } from '../lib/tools.js'
import { makeTempStorePath, makeTempWorkspace } from './helpers.ts'

const CJK = /[\u3400-\u9fff]/u

test('all policy surfaces require evidence-based durable knowledge in both languages', () => {
  const cases = [
    ['zh', [/精选长期记忆/, /长期偏好/, /纠正长期规则/, /验证过且可复用/, /Job ID/, /一句简短规则/, /不确定.*不写/, /明确要求.*记住/, /相关业务.*接续任务/, /跨项目.*引用/, /每轮最多一条/, /少量 compact 摘要/]],
    ['en', [/curated long-term memory/, /long-term preference/, /corrects a lasting rule/, /verified reusable solution/, /Job IDs/, /one concise rule/, /uncertain.*do not write/, /explicitly asks.*remember/, /related domain.*continuing task/, /cross-project.*clearly apply/, /at most one entry per turn/, /small set of compact summaries/]],
  ] as const
  for (const [language, rules] of cases) {
    const surfaces = [memoirGuidance(language), distillPrompt(language), hostCopy(language).record.description]
    for (const surface of surfaces) {
      for (const rule of rules) assert.match(surface, rule)
    }
    assert.doesNotMatch(distillPrompt(language), /若本轮有实质产出|If the turn produced substantive work/)
  }
})

test('the read tool advertises proactive recall without an unconditional session-start call', () => {
  const zh = hostCopy('zh').read.description(3)
  const en = hostCopy('en').read.description(3)
  for (const [surface, rules] of [
    [zh, [/相关业务.*接续任务/, /不要等用户追问历史/, /默认少量摘要/, /full\/global/]],
    [en, [/related domain.*continuing task/, /instead of waiting for the user to ask about history/, /default small set of summaries/, /full\/global/]],
  ] as const) {
    for (const rule of rules) assert.match(surface, rule)
  }
  assert.doesNotMatch(zh, /开始新会话或接手旧项目时先调用/)
  assert.doesNotMatch(en, /starting a new session/)
})

test('English agent copy contains no hardcoded Chinese in prompt surfaces', () => {
  const copy = hostCopy('en')
  for (const value of [
    memoirGuidance('en'),
    distillPrompt('en'),
    copy.sectionHeading,
    copy.hotMemory.header,
    copy.hotMemory.actions,
    copy.hotMemory.lessons,
    copy.hotMemory.recent,
  ]) {
    assert.doesNotMatch(value, CJK)
  }
  assert.match(distillPrompt('en'), /memoir_record/)
  assert.match(memoirGuidance('zh'), /项目持久记忆/)
})

test('English tools localize schemas, results, empty reads, and errors', async () => {
  const store = new MemoirStore(makeTempStorePath(), { language: 'en' })
  const retrieval = new RetrievalEngine(store)
  const record = memoirRecordTool(store, retrieval, 'en')
  const update = memoirUpdateTool(store, 'en')
  const read = memoirReadTool(store, undefined, retrieval, 'en')
  const recordParams = record.parameters as { properties: Record<string, { description?: string }> }

  assert.match(record.description, /Persist one project-memory entry/)
  assert.doesNotMatch(record.description, CJK)
  assert.doesNotMatch(recordParams.properties.section!.description!, CJK)
  assert.match(String((record.output.render({}, {
    section: 'work', action: 'recorded', recorded: true, id: 'm1', candidates: [],
  })[0] as { text?: string } | undefined)?.text), /^Recorded/)

  await assert.rejects(
    () => record.execute({ section: 'work', content: 'x' }, {} as never),
    /Cannot determine the session workspace/,
  )
  await assert.rejects(
    () => update.execute({ id: 'm1', content: 'x' }, {} as never),
    /Cannot determine the session workspace/,
  )
  const empty = await read.execute({ scope: 'project' }, {} as never) as { text: string }
  assert.match(empty.text, /workspace is unavailable/i)
  assert.doesNotMatch(empty.text, CJK)
})

test('English Hot Memory and PROJECT_MEMORY projection stay English', () => {
  const ws = makeTempWorkspace()
  try {
    const store = new MemoirStore(makeTempStorePath(), { language: 'en' })
    const entry = store.record(ws.cwd, {
      section: 'lessons',
      title: 'Release authentication',
      content: 'Use trusted publishing for npm releases.',
    })
    const hot = selectHotMemory([entry], { targetTokens: 900, hardMaxTokens: 1200 }, Date.now(), 'en')
    assert.match(hot.text, /^\[Project memory\]/)
    assert.match(hot.text, /Lessons:/)
    assert.doesNotMatch(hot.text, CJK)

    const markdown = readFileSync(join(ws.cwd, PROJECT_FILE), 'utf8')
    assert.match(markdown, /^# Persistent Project Memory/m)
    assert.match(markdown, /^## Lessons Learned/m)
    assert.doesNotMatch(markdown, CJK)

    const prompt = memoirSectionText(
      store,
      { agent: { id: 'english', session: { id: 'english', header: { cwd: ws.cwd } } } },
      undefined,
      { targetTokens: 900, hardMaxTokens: 1200 },
      'en',
    )
    assert.match(prompt, /Persistent project memory/)
    assert.match(prompt, /\[Project memory\]/)
    assert.doesNotMatch(prompt, CJK)
  } finally {
    ws.cleanup()
  }
})
