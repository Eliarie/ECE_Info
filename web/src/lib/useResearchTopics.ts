'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBookmarkDeviceId, getSyncedDeviceId, markSyncedDevice, RESEARCH_SYNCED_DEVICE_KEY } from '@/lib/useBookmarks'
import { normalizeTopic, STORED_ABSTRACT_LIMIT, type ResearchTopicData } from '@/lib/research'

const STORAGE_KEY = 'research_topics'
export const MAX_RESEARCH_TOPICS = 30

export type ResearchEntry = {
  topic: string
  created_at: string
  updated_at: string
  data: ResearchTopicData
  synced: boolean // 云端已确认存在过；为 false 的条目在下次能连上云端时补传
  dirty: boolean // 本地有改动还没写进云端
}

type RemoteEntry = { topic: string; created_at: string; updated_at: string; data: ResearchTopicData }

const readLocal = (): ResearchEntry[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as ResearchEntry[]) : []
  } catch {
    return []
  }
}

const writeLocal = (entries: ResearchEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.error('Research topics local save error:', error)
  }
}

// 只存截短的摘要，控制本地存储和云端的体积
const compact = (data: ResearchTopicData): ResearchTopicData => ({
  ...data,
  papers: data.papers.map((p) => ({ ...p, abstract: p.abstract.slice(0, STORED_ABSTRACT_LIMIT) })),
})

const byNewest = (a: ResearchEntry, b: ResearchEntry) => b.updated_at.localeCompare(a.updated_at)

// 云端为准：同一个专题本地有更新的改动就留本地的；云端没有的，本地从未同步过才保留（否则是在别的设备删掉了）
const mergeWithRemote = (local: ResearchEntry[], remote: RemoteEntry[]): ResearchEntry[] => {
  const localByTopic = new Map(local.map((e) => [e.topic, e]))
  const merged: ResearchEntry[] = remote.map((r) => {
    const mine = localByTopic.get(r.topic)
    if (mine?.dirty && mine.updated_at > r.updated_at) return { ...mine, synced: true }
    return { topic: r.topic, created_at: r.created_at, updated_at: r.updated_at, data: r.data, synced: true, dirty: false }
  })
  const remoteTopics = new Set(remote.map((r) => r.topic))
  for (const e of local) {
    if (!remoteTopics.has(e.topic) && !e.synced) merged.push(e)
  }
  return merged.sort(byNewest)
}

// 「专题研究」：每个专题存一份检索结果和综述。本地立即可用；与收藏共用同一个同步码跨设备同步。
export function useResearchTopics(client: SupabaseClient | null) {
  const [entries, setEntries] = useState<ResearchEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const entriesRef = useRef<ResearchEntry[]>([])
  const deviceIdRef = useRef<string | null>(null)

  const apply = useCallback((updater: (prev: ResearchEntry[]) => ResearchEntry[]) => {
    const next = updater(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
    writeLocal(next)
  }, [])

  const pushEntry = useCallback(async (entry: ResearchEntry) => {
    const deviceId = deviceIdRef.current
    if (!client || !deviceId) return false
    const { error } = await client.rpc('save_research_topic', {
      p_device_id: deviceId,
      p_topic: entry.topic,
      p_data: entry.data,
    })
    if (error) {
      console.error('Supabase research topic sync error:', error)
      return false
    }
    apply((prev) => prev.map((e) =>
      // 推送期间又改过（updated_at 变了）就仍算有改动，等下次补传
      e.topic === entry.topic ? { ...e, synced: true, dirty: e.updated_at !== entry.updated_at } : e
    ))
    return true
  }, [client, apply])

  useEffect(() => {
    // 本地的先显示出来，云端读回来再合并（大陆网络连 Supabase 有时要好几秒）
    const local = readLocal()
    entriesRef.current = local
    setEntries(local)
    setLoaded(true)

    try {
      deviceIdRef.current = getBookmarkDeviceId()
    } catch (error) {
      console.error('Research device initialization error:', error)
    }
    const deviceId = deviceIdRef.current
    if (!client || !deviceId) return

    let cancelled = false
    const synchronize = async () => {
      const syncedDevice = getSyncedDeviceId(RESEARCH_SYNCED_DEVICE_KEY)
      if (syncedDevice && syncedDevice !== deviceId) {
        // 刚扫码加入别的设备：本机的专题都属于旧同步码，当成未同步，并进新的同步组
        apply((prev) => prev.map((e) => ({ ...e, synced: false, dirty: true })))
      }
      const { data, error } = await client.rpc('get_research_topics', { p_device_id: deviceId })
      if (cancelled) return
      if (error) {
        console.error('Supabase research topics read error:', error)
        return
      }
      apply((prev) => mergeWithRemote(prev, (data ?? []) as RemoteEntry[]))
      markSyncedDevice(RESEARCH_SYNCED_DEVICE_KEY, deviceId)
      for (const e of entriesRef.current) {
        if (e.dirty && !cancelled) await pushEntry(e)
      }
    }
    void synchronize()
    return () => { cancelled = true }
  }, [client, apply, pushEntry])

  const saveTopic = useCallback((rawTopic: string, data: ResearchTopicData) => {
    const topic = normalizeTopic(rawTopic)
    if (!topic) return
    const now = new Date().toISOString()
    const existing = entriesRef.current.find((e) => e.topic === topic)
    const entry: ResearchEntry = {
      topic,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      data: compact(data),
      synced: existing?.synced ?? false,
      dirty: true,
    }
    apply((prev) => [entry, ...prev.filter((e) => e.topic !== topic)].slice(0, MAX_RESEARCH_TOPICS))
    void pushEntry(entry)
  }, [apply, pushEntry])

  const removeTopic = useCallback((topic: string) => {
    apply((prev) => prev.filter((e) => e.topic !== topic))
    const deviceId = deviceIdRef.current
    if (client && deviceId) {
      void client.rpc('remove_research_topic', { p_device_id: deviceId, p_topic: topic })
        .then(({ error }) => {
          if (error) console.error('Supabase research topic remove error:', error)
        })
    }
  }, [client, apply])

  return { entries, loaded, saveTopic, removeTopic }
}
