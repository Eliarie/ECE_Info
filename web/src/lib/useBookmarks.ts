'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

const BOOKMARK_DEVICE_KEY = 'bookmark_device_id'
const BOOKMARK_STORAGE_KEY = 'bookmarks'
// 本地数据已和哪个同步码的云端对齐过；和当前同步码不同，说明刚扫码加入了别的设备，本机原有的要并进去
const BOOKMARK_SYNCED_DEVICE_KEY = 'bookmarks_synced_device'
export const INTEREST_SYNCED_DEVICE_KEY = 'digest_interests_synced_device'
const SYNCED_DEVICE_KEYS = [BOOKMARK_SYNCED_DEVICE_KEY, INTEREST_SYNCED_DEVICE_KEY]
// 还没写进云端的收藏改动：文章 id → 收藏 / 取消收藏（离线或请求失败时留着，下次打开补传）
const BOOKMARK_PENDING_KEY = 'bookmarks_pending'

type PendingChanges = Record<string, boolean>

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export const getSyncedDeviceId = (key: string) => {
  try { return localStorage.getItem(key) } catch { return null }
}

export const markSyncedDevice = (key: string, deviceId: string) => {
  try { localStorage.setItem(key, deviceId) } catch {}
}

// 收藏在本地按设备 id 存储；带 bookmark_sync 参数打开时改用链接里的设备 id，
// 这样另一台设备的收藏可以合并过来。
export const getBookmarkDeviceId = () => {
  const params = new URLSearchParams(window.location.search)
  const sharedId = params.get('bookmark_sync')
  if (sharedId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sharedId)) {
    const previousId = localStorage.getItem(BOOKMARK_DEVICE_KEY)
    if (previousId && previousId !== sharedId) {
      // 本机原来的数据属于旧同步码：记下来，收藏和兴趣同步时会把它们并进新的同步组
      for (const key of SYNCED_DEVICE_KEYS) {
        if (!localStorage.getItem(key)) localStorage.setItem(key, previousId)
      }
    }
    localStorage.setItem(BOOKMARK_DEVICE_KEY, sharedId)
    params.delete('bookmark_sync')
    const clean = `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', clean)
  }
  let deviceId = localStorage.getItem(BOOKMARK_DEVICE_KEY)
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(BOOKMARK_DEVICE_KEY, deviceId)
  }
  return deviceId
}

// 速览页与全部文章页共用同一份收藏：本地立即生效，再与 Supabase 同步。
// 同步码对齐过之后以云端为准，这样在一台设备取消的收藏，另一台设备打开时也会消失；
// 只有第一次同步（含刚扫码加入）时，才把本机原有的收藏并进去。
export function useBookmarks(client: SupabaseClient | null) {
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const bookmarksRef = useRef<Set<string>>(bookmarks)
  const deviceIdRef = useRef<string | null>(null)

  const applyBookmarks = useCallback((next: Set<string>) => {
    bookmarksRef.current = next
    setBookmarks(next)
    writeJson(BOOKMARK_STORAGE_KEY, Array.from(next))
  }, [])

  // 写一条改动到云端；成功且期间没被再次改动，才从待补传里移除
  const pushChange = useCallback(async (deviceId: string, articleId: string, saved: boolean) => {
    if (!client) return false
    const { error } = await client.rpc('set_article_saved', {
      p_device_id: deviceId,
      p_article_id: articleId,
      p_saved: saved,
    })
    if (error) {
      console.error('Supabase bookmark sync error:', error)
      return false
    }
    const pending = readJson<PendingChanges>(BOOKMARK_PENDING_KEY, {})
    if (pending[articleId] === saved) {
      delete pending[articleId]
      writeJson(BOOKMARK_PENDING_KEY, pending)
    }
    return true
  }, [client])

  useEffect(() => {
    const localIds = readJson<string[]>(BOOKMARK_STORAGE_KEY, [])
    applyBookmarks(new Set(localIds))

    let deviceId: string
    try {
      deviceId = getBookmarkDeviceId()
      deviceIdRef.current = deviceId
    } catch (error) {
      console.error('Bookmark device initialization error:', error)
      return
    }
    if (!client) return

    let cancelled = false
    const synchronizeBookmarks = async () => {
      try {
        const pending = readJson<PendingChanges>(BOOKMARK_PENDING_KEY, {})
        if (getSyncedDeviceId(BOOKMARK_SYNCED_DEVICE_KEY) !== deviceId) {
          // 第一次和这个同步码对齐：本机已有的收藏都要并进云端
          for (const id of localIds) if (!(id in pending)) pending[id] = true
          writeJson(BOOKMARK_PENDING_KEY, pending)
        }
        for (const [articleId, saved] of Object.entries(pending)) {
          if (cancelled) return
          await pushChange(deviceId, articleId, saved)
        }

        const { data, error } = await client.rpc('get_saved_article_ids', { p_device_id: deviceId })
        if (cancelled) return
        if (error) {
          console.error('Supabase bookmark read error:', error)
          return
        }
        // 云端为准，再叠上还没补传成功的本地改动
        const next = new Set<string>((data ?? []).map((row: { article_id: string }) => row.article_id))
        for (const [articleId, saved] of Object.entries(readJson<PendingChanges>(BOOKMARK_PENDING_KEY, {}))) {
          if (saved) next.add(articleId)
          else next.delete(articleId)
        }
        applyBookmarks(next)
        markSyncedDevice(BOOKMARK_SYNCED_DEVICE_KEY, deviceId)
      } catch (error) {
        console.error('Bookmark sync error:', error)
      }
    }
    void synchronizeBookmarks()
    return () => { cancelled = true }
  }, [client, applyBookmarks, pushChange])

  const toggleBookmark = useCallback((id: string) => {
    const next = new Set(bookmarksRef.current)
    const shouldSave = !next.has(id)
    if (shouldSave) next.add(id)
    else next.delete(id)
    applyBookmarks(next)

    const pending = readJson<PendingChanges>(BOOKMARK_PENDING_KEY, {})
    pending[id] = shouldSave
    writeJson(BOOKMARK_PENDING_KEY, pending)
    const deviceId = deviceIdRef.current
    if (deviceId) void pushChange(deviceId, id, shouldSave)
  }, [applyBookmarks, pushChange])

  // 生成带同步码的链接（指向速览首页），由同步弹窗显示成二维码和可复制的链接。
  const getSyncLink = useCallback(() => {
    const deviceId = deviceIdRef.current ?? getBookmarkDeviceId()
    deviceIdRef.current = deviceId
    const url = new URL(`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`)
    url.searchParams.set('bookmark_sync', deviceId)
    return url.toString()
  }, [])

  return { bookmarks, toggleBookmark, getSyncLink }
}
