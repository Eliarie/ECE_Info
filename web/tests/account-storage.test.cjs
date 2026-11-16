const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function setup(seed = {}) {
  const data = new Map(Object.entries(seed))
  const localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
  const exports = {}
  let cleaned = ''
  const code = ts.transpileModule(fs.readFileSync(__dirname + '/../src/lib/accountStorage.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, localStorage, URL, window: { location: { href: 'https://example.test/browse/?favorites=1&bookmark_sync=legacy#results' }, history: { replaceState: (_, __, url) => { cleaned = url } } } })
  return { data, prepare: exports.prepareAccountStorage, cleaned: () => cleaned }
}
const account = { id: 'account-a' }
const namespace = '11111111-1111-4111-8111-111111111111'
const legacy = '22222222-2222-4222-8222-222222222222'
const client = { rpc: async name => ({ data: name === 'get_account_sync_id' ? namespace : null, error: null }) }

test('guest data imports once; offline removal wins; old links cannot override account', async () => {
  const s = setup({ bookmark_device_id: legacy, bookmarks: '["saved","removed"]', bookmarks_pending: '{"removed":false}', research_topics: JSON.stringify([{ topic: 'play', updated_at: '2026-11-16', synced: false, dirty: true }]) })
  await s.prepare(client, account)
  assert.equal(s.data.get('bookmark_device_id'), namespace)
  assert.deepEqual(JSON.parse(s.data.get('bookmarks_pending')), { saved: true, removed: false })
  assert.equal(JSON.parse(s.data.get('research_topics'))[0].dirty, true)
  assert.equal(s.cleaned(), '/browse/?favorites=1#results')
  assert.equal(s.data.has('ece_account_cache:guest'), false)
  await s.prepare(client, null)
  assert.equal(s.data.has('bookmarks'), false)
  await s.prepare(client, account)
  assert.equal(s.data.get('bookmarks_synced_device'), namespace)
})

test('switching accounts preserves each pending queue and never merges account A into B', async () => {
  const s = setup({ ece_data_owner: 'account-a', bookmark_device_id: namespace, bookmarks: '["only-a"]', bookmarks_pending: '{"only-a":true}', bookmarks_synced_device: namespace })
  await s.prepare(client, { id: 'account-b' })
  assert.equal(s.data.has('bookmarks'), false)
  s.data.set('bookmarks', '["only-b"]')
  await s.prepare(client, account)
  assert.deepEqual(JSON.parse(s.data.get('bookmarks')), ['only-a'])
  assert.deepEqual(JSON.parse(s.data.get('bookmarks_pending')), { 'only-a': true })
})

test('returning to an account imports new guest changes without marking old cache for re-upload', async () => {
  const cached = { bookmarks: '["stale-remote-deletion"]', bookmarks_pending: '{}', bookmarks_synced_device: namespace, research_topics: JSON.stringify([{ topic: 'old', synced: true, dirty: false }]) }
  const s = setup({ ece_data_owner: 'guest', bookmark_device_id: legacy, bookmarks: '["guest-new"]', 'ece_account_cache:account-a': JSON.stringify(cached) })
  await s.prepare(client, account)
  assert.deepEqual(JSON.parse(s.data.get('bookmarks_pending')), { 'guest-new': true })
  assert.equal(JSON.parse(s.data.get('research_topics'))[0].synced, true)
})

test('failed cloud import leaves all original local data intact for retry', async () => {
  const s = setup({ bookmark_device_id: legacy, bookmarks: '["original"]' })
  await assert.rejects(s.prepare({ rpc: async name => name === 'get_account_sync_id' ? { data: namespace } : { error: new Error('offline') } }, account))
  assert.equal(s.data.get('bookmark_device_id'), legacy)
  assert.equal(s.data.get('bookmarks'), '["original"]')
  assert.equal(s.data.has('ece_data_owner'), false)
})

test('an already synchronized legacy cache cannot resurrect an account deletion', async () => {
  const s = setup({ bookmark_device_id: legacy, bookmarks: '["old-favorite"]', bookmarks_synced_device: legacy, research_topics: JSON.stringify([{ topic: 'old-topic', updated_at: '2026-11-01', synced: true, dirty: false }]), digest_interests: JSON.stringify([{ interest: 'old-interest', digests: [], synced: true, unsyncedWeeks: [] }]) })
  await s.prepare(client, account)
  assert.deepEqual(JSON.parse(s.data.get('bookmarks_pending')), {})
  assert.deepEqual(JSON.parse(s.data.get('research_topics')), [])
  assert.deepEqual(JSON.parse(s.data.get('digest_interests')), [])
})
