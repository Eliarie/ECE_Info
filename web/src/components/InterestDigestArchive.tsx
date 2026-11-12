'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useInterestDigests } from '@/lib/useInterestDigests'

// 保留原有兴趣及往期结果；新的主题统一从专题研究的输入框开始。
export default function InterestDigestArchive({ client }: { client: SupabaseClient | null }) {
  const { entries, loaded, removeInterest } = useInterestDigests(client)
  const [selectedInterest, setSelectedInterest] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [links, setLinks] = useState<Map<string, string>>(new Map())
  const [linkError, setLinkError] = useState(false)
  const entry = entries.find((item) => item.interest === selectedInterest) ?? entries[0]
  const digest = entry?.digests.find((item) => item.week_start === selectedWeek) ?? entry?.digests[0]
  const overview = digest?.overview_zh || digest?.overview_en || ''
  const refs = useMemo(() => Array.from(new Set(
    Array.from(overview.matchAll(/\[[^\]]+\]\((\d+|[0-9a-f-]{36})\)/gi), (match) => match[1].toLowerCase())
  )), [overview])

  useEffect(() => {
    setLinks(new Map())
    setLinkError(false)
    if (!client || !digest || refs.length === 0) return
    let cancelled = false
    const loadLinks = async () => {
      let positions: string[] = []
      if (refs.some((ref) => /^\d+$/.test(ref))) {
        const { data, error } = await client.from('weekly_digests').select('article_ids')
          .eq('week_start', digest.week_start).maybeSingle()
        if (error) throw error
        positions = data?.article_ids ?? []
      }
      const idFor = (ref: string) => /^\d+$/.test(ref) ? positions[Number(ref) - 1] : ref
      const ids = Array.from(new Set(refs.map(idFor).filter(Boolean)))
      if (ids.length === 0) return
      const { data, error } = await client.from('articles').select('id,source_url').in('id', ids)
      if (error) throw error
      const urls = new Map<string, string>((data ?? []).map((row) => [row.id, row.source_url]))
      if (!cancelled) setLinks(new Map(refs.flatMap((ref) => {
        const url = urls.get(idFor(ref))
        return url ? [[ref, url] as [string, string]] : []
      })))
    }
    void loadLinks().catch((error) => {
      console.error('Interest archive links error:', error)
      if (!cancelled) setLinkError(true)
    })
    return () => { cancelled = true }
  }, [client, digest, refs])

  const renderParagraph = (paragraph: string) => {
    const parts: ReactNode[] = []
    const pattern = /\[([^\]]+)\]\((\d+|[0-9a-f-]{36})\)/gi
    let start = 0
    for (const match of paragraph.matchAll(pattern)) {
      parts.push(paragraph.slice(start, match.index))
      const url = links.get(match[2].toLowerCase())
      parts.push(url ? (
        <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
          className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{match[1]}</a>
      ) : match[1])
      start = match.index! + match[0].length
    }
    parts.push(paragraph.slice(start))
    return parts
  }

  if (loaded && entries.length === 0) return null

  return (
    <details className="mt-8 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700 focus-visible:outline-blue-500">
        已保存的兴趣速览{entries.length > 0 ? `（${entries.length}）` : ''}
      </summary>
      {!loaded && entries.length === 0 ? <p className="mt-3 text-sm text-gray-400">加载中…</p> : entry && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="选择已保存的兴趣" value={entry.interest}
              onChange={(event) => { setSelectedInterest(event.target.value); setSelectedWeek('') }}
              className="h-9 min-w-0 max-w-full rounded-lg border border-gray-200 bg-white px-2 text-sm">
              {entries.map((item) => <option key={item.interest} value={item.interest}>{item.interest}</option>)}
            </select>
            {digest && (
              <select aria-label="选择兴趣速览期数" value={digest.week_start}
                onChange={(event) => setSelectedWeek(event.target.value)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm">
                {entry.digests.map((item) => <option key={item.week_start} value={item.week_start}>{item.week_start}</option>)}
              </select>
            )}
            <button type="button" onClick={() => {
              if (window.confirm(`删除「${entry.interest}」和它的全部往期速览？已同步的其他设备上也会一起删除。`)) removeInterest(entry.interest)
            }} className="h-9 rounded-lg px-2 text-xs text-gray-500 hover:text-red-600">删除</button>
          </div>
          <div className="mt-4 space-y-4">
            {overview.split(/\n+/).filter((paragraph) => paragraph.trim()).map((paragraph, index) => (
              <p key={index} className="text-base leading-8 text-gray-800">{renderParagraph(paragraph)}</p>
            ))}
            {!digest && <p className="text-sm text-gray-400">这个兴趣还没有已保存的速览。</p>}
          </div>
          {linkError && <p className="mt-3 text-xs text-red-600">论文链接加载失败，请刷新重试。</p>}
          <p className="mt-4 text-xs text-gray-400">以前保存的兴趣速览保留在这里，文中链接打开论文原文。新的主题请在上方输入。</p>
        </div>
      )}
    </details>
  )
}
