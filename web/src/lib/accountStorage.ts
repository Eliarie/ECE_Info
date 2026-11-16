import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { ResearchEntry } from './useResearchTopics'
import type { InterestEntry, InterestDigest } from './useInterestDigests'

const OWNER_KEY = 'ece_data_owner'
const KEYS = [
  'bookmark_device_id', 'bookmarks', 'bookmarks_pending', 'bookmarks_synced_device',
  'digest_interests', 'digest_interest', 'digest_interest_cache', 'digest_interests_synced_device',
  'research_topics', 'research_topics_synced_device',
] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cacheKey = (owner: string) => `ece_account_cache:${owner}`

// Resolve an account's namespace on the server; never derive it from an email
// or allow a browser to choose another account's namespace.
export async function prepareAccountStorage(client: SupabaseClient, user: User | null) {
  const previous = localStorage.getItem(OWNER_KEY) ?? 'guest'
  const owner = user?.id ?? 'guest'
  let syncId: string | null = null
  let legacyCloudChecked = false
  if (user) {
    const { data, error } = await client.rpc('get_account_sync_id')
    if (error) throw error
    if (typeof data !== 'string' || !UUID.test(data)) throw new Error('Invalid account namespace')
    syncId = data
    if (previous === 'guest') {
      const legacyId = localStorage.getItem('bookmark_device_id')
      if (legacyId && UUID.test(legacyId)) {
        // Import cloud-only topics and archives too, before touching local data.
        // The server imports only changes newer than its previous import, so
        // stale legacy data cannot restore favorites removed in the account.
        const result = await client.rpc('import_legacy_sync', { p_device_id: legacyId })
        if (result.error) throw result.error
        legacyCloudChecked = true
      }
    }
  }

  if (previous !== owner) {
    const snapshot = Object.fromEntries(KEYS.map((key) => [key, localStorage.getItem(key)]))
    // Take a backup before clearing/switching any account data.
    localStorage.setItem(cacheKey(previous), JSON.stringify(snapshot))
    const saved = JSON.parse(localStorage.getItem(cacheKey(owner)) ?? '{}') as Record<string, string | null>
    const importGuest = previous === 'guest' && Boolean(user)
    for (const key of KEYS) {
      const value = saved[key]
      if (value != null) localStorage.setItem(key, value)
      else localStorage.removeItem(key)
    }
    if (importGuest) {
      const parse = <T,>(value: string | null | undefined, fallback: T): T => value ? JSON.parse(value) : fallback
      const pending = parse<Record<string, boolean>>(saved.bookmarks_pending, {})
      const guestAlreadySynced = legacyCloudChecked && snapshot.bookmark_device_id && snapshot.bookmarks_synced_device === snapshot.bookmark_device_id
      if (!guestAlreadySynced) for (const id of parse<string[]>(snapshot.bookmarks, [])) pending[id] = true
      Object.assign(pending, parse<Record<string, boolean>>(snapshot.bookmarks_pending, {}))
      localStorage.setItem('bookmarks_pending', JSON.stringify(pending))
      localStorage.setItem('bookmarks', JSON.stringify(Array.from(new Set([
        ...parse<string[]>(saved.bookmarks, []), ...parse<string[]>(snapshot.bookmarks, []),
      ]))))
      localStorage.setItem('bookmarks_synced_device', syncId!)

      const topics = new Map(parse<ResearchEntry[]>(saved.research_topics, []).map((entry) => [entry.topic, entry]))
      for (const entry of parse<ResearchEntry[]>(snapshot.research_topics, [])) {
        if (legacyCloudChecked && entry.synced && !entry.dirty) continue
        const existing = topics.get(entry.topic)
        if (!existing || entry.updated_at > existing.updated_at) topics.set(entry.topic, { ...entry, synced: false, dirty: true })
      }
      localStorage.setItem('research_topics', JSON.stringify(Array.from(topics.values())))
      localStorage.setItem('research_topics_synced_device', syncId!)
      const interests = new Map(parse<InterestEntry[]>(saved.digest_interests, []).map((entry) => [entry.interest, entry]))
      const guestInterests = parse<InterestEntry[]>(snapshot.digest_interests, [])
      if (!guestInterests.length && snapshot.digest_interest) {
        const cache = parse<InterestDigest & { interest: string } | null>(snapshot.digest_interest_cache, null)
        const digests = cache?.interest === snapshot.digest_interest ? [cache] : []
        guestInterests.push({ interest: snapshot.digest_interest, created_at: new Date().toISOString(), digests, synced: false, unsyncedWeeks: digests.map((d) => d.week_start) })
      }
      for (const entry of guestInterests) {
        if (legacyCloudChecked && entry.synced && !entry.unsyncedWeeks?.length) continue
        const existing = interests.get(entry.interest)
        const digests = Array.from(new Map([...(existing?.digests ?? []), ...entry.digests].map((digest) => [digest.week_start, digest])).values())
        interests.set(entry.interest, { ...entry, digests, synced: false, unsyncedWeeks: digests.map((d) => d.week_start) })
      }
      localStorage.setItem('digest_interests', JSON.stringify(Array.from(interests.values())))
      localStorage.setItem('digest_interests_synced_device', syncId!)
      localStorage.removeItem(cacheKey('guest'))
    }
    localStorage.setItem(OWNER_KEY, owner)
  }
  if (syncId) localStorage.setItem('bookmark_device_id', syncId)

  // Legacy links may still be opened, but must never override a signed-in account.
  if (user) {
    const url = new URL(window.location.href)
    if (url.searchParams.has('bookmark_sync')) {
      url.searchParams.delete('bookmark_sync')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }
}

