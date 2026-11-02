import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(join(ROOT, 'src', 'client', 'index.tsx'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string
  engines?: { node?: string; dsh?: string }
  dsh?: {
    engines?: { dsh?: string }
    client?: { inject?: string[] }
  }
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
}

test('the SQLite fork declares release candidates with literal prompt sections', () => {
  assert.equal(packageJson.version, '0.1.1')
  const supported = '0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.2'
  assert.equal(packageJson.engines?.dsh, supported, 'DSH boot reads the top-level engines declaration')
  assert.equal(packageJson.dsh?.engines?.dsh, supported)
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/dsh-llm'], supported)
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/dsh-tools'], supported)
  assert.equal(packageJson.dependencies, undefined, 'the published package keeps zero bundled runtime dependencies')
})

test('native client providers include the workspace navigation owner with the rc.2 build baseline', () => {
  assert.deepEqual(packageJson.dsh?.client?.inject, [
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-settings-general',
  ])
  assert.equal(packageJson.devDependencies?.['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(packageJson.devDependencies?.['@deepseek-ai/dsh-client-ui-slots'], '0.2.1-rc.2')
  for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) {
      assert.equal(version, '0.2.1-rc.2', `${name} must compile against the rc.2 baseline`)
    }
  }
})

test('native client entry keeps official slot types without legacy DOM mounting', () => {
  assert.match(clientSource, /import type \{ ConvViewProps \} from '@deepseek-ai\/dsh-client-ui-conversation\/client'/)
  assert.match(clientSource, /PropsRuntime<'settings\.section'>/)
  assert.match(clientSource, /SessionListState/)
  assert.match(clientSource, /data-conversation-composer-overlay/)
  assert.ok(!clientSource.includes('interface NativeSlotsLike'))
  assert.ok(!clientSource.includes('as unknown as'))
})
