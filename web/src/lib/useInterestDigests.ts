'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBookmarkDeviceId, getSyncedDeviceId, INTEREST_SYNCED_DEVICE_KEY, markSyncedDevice } from '@/lib/useBookmarks'

const STORAGE_KEY = 'digest_interests'
// 旧版只存一个兴趣：兴趣词 + 当周概览缓存
const LEGACY_INTEREST_KEY = 'digest_interest'
const LEGACY_CACHE_KEY = 'digest_interest_cache'

export const MAX_INTERESTS = 30

export type InterestDigest = {
  week_start: string
  overview_zh: string
  overview_en: string
}

export type InterestEntry = {
  interest: string
  created_at: string
  digests: InterestDigest[] // 新的在前
  synced: boolean // 云端已确认存在；为 false 的条目在下次能连上云端时补传
  unsyncedWeeks: string[] // 本地生成但还没写进云端的周
}

export const normalizeInterest = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 60)

const sortDigests = (digests: InterestDigest[]) =>
  [...digests].sort((a, b) => b.week_start.localeCompare(a.week_start))

const readLocal = (): InterestEntry[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as InterestEntry[]
      if (Array.isArray(parsed)) {
        return parsed.map((e) => ({ ...e, unsyncedWeeks: e.unsyncedWeeks ?? [] }))
      }
    }
    const legacyInterest = normalizeInterest(localStorage.getItem(LEGACY_INTEREST_KEY) ?? '')
    if (!legacyInterest) return []
    const legacyCache = JSON.parse(localStorage.getItem(LEGACY_CACHE_KEY) ?? 'null') as
      | { interest: string; week_start: string; overview_zh: string; overview_en: string }
      | null
    const digests =
      legacyCache && normalizeInterest(legacyCache.interest) === legacyInterest && legacyCache.overview_zh
        ? [{ week_start: legacyCache.week_start, overview_zh: legacyCache.overview_zh, overview_en: legacyCache.overview_en ?? '' }]
        : []
    return [{
      interest: legacyInterest,
      created_at: new Date().toISOString(),
      digests,
      synced: false,
      unsyncedWeeks: digests.map((d) => d.week_start),
    }]
  } catch {
    return []
  }
}

const writeLocal = (entries: InterestEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    localStorage.removeItem(LEGACY_INTEREST_KEY)
    localStorage.removeItem(LEGACY_CACHE_KEY)
  } catch {}
}

type RemoteEntry = { interest: string; created_at: string; digests: InterestDigest[] }

// 云端为准：云端有的兴趣合并本地多出来的周；云端没有的，本地从未同步过才保留（否则是在别的设备删掉了）
const mergeWithRemote = (local: InterestEntry[], remote: RemoteEntry[]): InterestEntry[] => {
  const localByInterest = new Map(local.map((e) => [e.interest, e]))
  const merged: InterestEntry[] = remote.map((r) => {
    const mine = localByInterest.get(r.interest)
    const remoteWeeks = new Set(r.digests.map((d) => d.week_start))
    const localOnly = (mine?.digests ?? []).filter((d) => !remoteWeeks.has(d.week_start))
    return {
      interest: r.interest,
      created_at: r.created_at,
      digests: sortDigests([...r.digests, ...localOnly]),
      synced: true,
      unsyncedWeeks: localOnly.map((d) => d.week_start),
    }
  })
  const remoteInterests = new Set(remote.map((r) => r.interest))
  for (const e of local) {
    if (!remoteInterests.has(e.interest) && !e.synced) merged.push(e)
  }
  return merged.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

// 首页的兴趣速览：可订阅多个兴趣，每个兴趣按周存档。
// 本地立即可用；与收藏共用同一个同步码，在 Supabase 上跨设备同步。
export function useInterestDigests(client: SupabaseClient | null) {
  const [entries, setEntries] = useState<InterestEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const entriesRef = useRef<InterestEntry[]>([])
  const deviceIdRef = useRef<string | null>(null)

  const apply = useCallback((updater: (prev: InterestEntry[]) => InterestEntry[]) => {
    const next = updater(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
    writeLocal(next)
  }, [])

  const pushDigest = useCallback(async (interest: string, digest: InterestDigest) => {
    const deviceId = deviceIdRef.current
    if (!client || !deviceId) return false
    const { error } = await client.rpc('save_interest_digest', {
      p_device_id: deviceId,
      p_interest: interest,
      p_week_start: digest.week_start,
      p_overview_zh: digest.overview_zh,
      p_overview_en: digest.overview_en,
    })
    if (error) {
      console.error('Supabase interest digest sync error:', error)
      return false
    }
    apply((prev) => prev.map((e) =>
      e.interest === interest
        ? { ...e, synced: true, unsyncedWeeks: e.unsyncedWeeks.filter((w) => w !== digest.week_start) }
        : e
    ))
    return true
  }, [client, apply])

  useEffect(() => {
    const local = readLocal()
    entriesRef.current = local
    setEntries(local)
    writeLocal(local)

    try {
      deviceIdRef.current = getBookmarkDeviceId()
    } catch (error) {
      console.error('Interest device initialization error:', error)
    }
    const deviceId = deviceIdRef.current
    if (!client || !deviceId) {
      setLoaded(true)
      return
    }

    let cancelled = false
    const synchronize = async () => {
      const syncedDevice = getSyncedDeviceId(INTEREST_SYNCED_DEVICE_KEY)
      if (syncedDevice && syncedDevice !== deviceId) {
        // 刚扫码加入别的设备：本机的兴趣都属于旧同步码，当成未同步，并进新的同步组
        apply((prev) => prev.map((e) => ({ ...e, synced: false, unsyncedWeeks: e.digests.map((d) => d.week_start) })))
      }
      const { data, error } = await client.rpc('get_user_interests', { p_device_id: deviceId })
      if (cancelled) return
      if (error) {
        console.error('Supabase interest read error:', error)
        setLoaded(true)
        return
      }
      apply((prev) => mergeWithRemote(prev, (data ?? []) as RemoteEntry[]))
      markSyncedDevice(INTEREST_SYNCED_DEVICE_KEY, deviceId)
      setLoaded(true)
      for (const e of entriesRef.current) {
        for (const week of e.unsyncedWeeks) {
          const digest = e.digests.find((d) => d.week_start === week)
          if (digest && !cancelled) await pushDigest(e.interest, digest)
        }
      }
    }
    void synchronize()
    return () => { cancelled = true }
  }, [client, apply, pushDigest])

  const saveDigest = useCallback((rawInterest: string, digest: InterestDigest) => {
    const interest = normalizeInterest(rawInterest)
    if (!interest) return
    apply((prev) => {
      const existing = prev.find((e) => e.interest === interest)
      if (!existing) {
        return [...prev, {
          interest,
          created_at: new Date().toISOString(),
          digests: [digest],
          synced: false,
          unsyncedWeeks: [digest.week_start],
        }]
      }
      return prev.map((e) => e.interest === interest
        ? {
            ...e,
            digests: sortDigests([digest, ...e.digests.filter((d) => d.week_start !== digest.week_start)]),
            unsyncedWeeks: Array.from(new Set([...e.unsyncedWeeks, digest.week_start])),
          }
        : e)
    })
    void pushDigest(interest, digest)
  }, [apply, pushDigest])

  const removeInterest = useCallback((interest: string) => {
    apply((prev) => prev.filter((e) => e.interest !== interest))
    const deviceId = deviceIdRef.current
    if (client && deviceId) {
      void client.rpc('remove_user_interest', { p_device_id: deviceId, p_interest: interest })
        .then(({ error }) => {
          if (error) console.error('Supabase interest remove error:', error)
        })
    }
  }, [client, apply])

  return { entries, loaded, saveDigest, removeInterest }
}
