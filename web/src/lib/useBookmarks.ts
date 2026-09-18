'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

const BOOKMARK_DEVICE_KEY = 'bookmark_device_id'
const BOOKMARK_STORAGE_KEY = 'bookmarks'

// 收藏在本地按设备 id 存储；带 bookmark_sync 参数打开时改用链接里的设备 id，
// 这样另一台设备的收藏可以合并过来。
export const getBookmarkDeviceId = () => {
  const params = new URLSearchParams(window.location.search)
  const sharedId = params.get('bookmark_sync')
  if (sharedId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sharedId)) {
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

// 速览页与全部文章页共用同一份收藏：本地立即生效，再与 Supabase 双向同步。
export function useBookmarks(client: SupabaseClient | null) {
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const bookmarksRef = useRef<Set<string>>(bookmarks)
  const deviceIdRef = useRef<string | null>(null)

  const applyBookmarks = useCallback((next: Set<string>) => {
    bookmarksRef.current = next
    setBookmarks(next)
    try {
      localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(Array.from(next)))
    } catch {}
  }, [])

  useEffect(() => {
    let localIds: string[] = []
    try {
      const saved = localStorage.getItem(BOOKMARK_STORAGE_KEY)
      localIds = saved ? JSON.parse(saved) : []
      const local = new Set(localIds)
      bookmarksRef.current = local
      setBookmarks(local)
    } catch {}

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
        const { data, error } = await client.rpc('get_saved_article_ids', { p_device_id: deviceId })
        if (error) console.error('Supabase bookmark read error:', error)
        const remoteIds = (data ?? []).map((row: { article_id: string }) => row.article_id)
        if (!cancelled) {
          applyBookmarks(new Set([...localIds, ...remoteIds]))
        }
        for (const articleId of localIds) {
          const { error: saveError } = await client.rpc('set_article_saved', {
            p_device_id: deviceId,
            p_article_id: articleId,
            p_saved: true,
          })
          if (saveError) console.error('Supabase bookmark sync error:', saveError)
        }
      } catch (error) {
        console.error('Bookmark device initialization error:', error)
      }
    }
    void synchronizeBookmarks()
    return () => { cancelled = true }
  }, [client, applyBookmarks])

  const toggleBookmark = useCallback((id: string) => {
    const next = new Set(bookmarksRef.current)
    const shouldSave = !next.has(id)
    if (shouldSave) next.add(id)
    else next.delete(id)
    applyBookmarks(next)

    const deviceId = deviceIdRef.current
    if (client && deviceId) {
      void client.rpc('set_article_saved', {
        p_device_id: deviceId,
        p_article_id: id,
        p_saved: shouldSave,
      }).then(({ error }) => {
        if (error) console.error('Supabase bookmark sync error:', error)
      })
    }
  }, [client, applyBookmarks])

  // 生成带设备 id 的同步链接，并尽量写入剪贴板（权限不可用时由调用方展示链接）。
  const shareBookmarkSync = useCallback(async () => {
    const deviceId = deviceIdRef.current ?? getBookmarkDeviceId()
    deviceIdRef.current = deviceId
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('bookmark_sync', deviceId)
    const link = url.toString()
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // 复制权限不可用时仍返回链接，由页面内展示。
    }
    return link
  }, [])

  return { bookmarks, toggleBookmark, shareBookmarkSync }
}
