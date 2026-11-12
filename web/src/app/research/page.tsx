'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import {
  normalizeTopic,
  RESEARCH_REF_PATTERN,
  type ResearchPaper,
  type ResearchReview,
  type ResearchSearchResult,
  type ResearchTopicData,
} from '@/lib/research'
import { MAX_RESEARCH_TOPICS, useResearchTopics, type ResearchEntry } from '@/lib/useResearchTopics'
import { useBookmarks } from '@/lib/useBookmarks'
import { UI_TEXT } from '@/lib/i18n'
import NavIconButton, { BookmarkIcon, BrowseIcon, ResearchIcon, SyncIcon } from '@/components/NavIconButton'
import SyncDeviceDialog from '@/components/SyncDeviceDialog'
import InterestDigestArchive from '@/components/InterestDigestArchive'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null
// GitHub Pages 备用站是静态导出，没有 /api，只能看已保存的专题
const isStaticSite = Boolean(process.env.NEXT_PUBLIC_BASE_PATH)

// 专题研究页只有中文界面，导航沿用站点的中文文案
const text = UI_TEXT.zh

const SCREEN_BATCH = 15
const SCREEN_CONCURRENCY = 4
const REVIEW_MAX_PAPERS = 40
// 检查新发表时旧文章也留着，一个专题最多存这么多篇
const MAX_KEPT_PAPERS = 100

type Phase = 'idle' | 'searching' | 'screening' | 'reviewing'
type SortMode = 'relevance' | 'newest' | 'cited'

const EXAMPLES = ['游戏中的同伴冲突', '近10年 人工智能与幼儿学习', '父母屏幕使用与幼儿语言发展', '幼儿园户外活动与身体发展']

const LINK_CLASS =
  'text-blue-700 underline decoration-blue-300/70 underline-offset-[3px] transition-colors hover:text-blue-900 hover:decoration-blue-500'

const paperAnchor = (key: string) => `paper-${key}`

const postJson = async (url: string, body: unknown) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const error = new Error(data?.error || `HTTP ${resp.status}`) as Error & { reason?: string }
    error.reason = data?.reason
    throw error
  }
  return data
}

const failureMessage = (error: unknown, fallback: string) => {
  const reason = (error as { reason?: string })?.reason ?? ''
  if (reason === 'missing_key') return `${fallback}：服务器没有配置模型密钥。`
  if (reason.startsWith('openalex_429') || reason.startsWith('crossref_429')) return `${fallback}：文献数据库暂时限流，过一分钟再试。`
  return `${fallback}，请稍后重试。${reason ? `（${reason}）` : ''}`
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })

const yearRange = (data: Pick<ResearchTopicData, 'from_year' | 'to_year'>) => {
  if (data.from_year && data.to_year) return `${data.from_year}–${data.to_year} 年`
  if (data.from_year) return `${data.from_year} 年以来`
  if (data.to_year) return `${data.to_year} 年以前`
  return '不限年份'
}

// 筛选过的按相关度排，没筛过的当作「部分相关」
const relevanceOf = (p: ResearchPaper) => p.relevance ?? 1

const sortPapers = (papers: ResearchPaper[], mode: SortMode) => {
  const list = [...papers]
  if (mode === 'newest') list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  else if (mode === 'cited') list.sort((a, b) => b.cited_by - a.cited_by)
  else list.sort((a, b) => relevanceOf(b) - relevanceOf(a))
  return list
}

const formatAuthors = (authors: string[]) =>
  authors.length > 3 ? `${authors.slice(0, 3).join(', ')} 等` : authors.join(', ')

// 综述里的 [短语](文章key)：跳到下面清单里对应的卡片
function renderRefs(text: string, papersByKey: Map<string, ResearchPaper>, onJump: (key: string) => void): ReactNode {
  const parts: ReactNode[] = []
  const regex = new RegExp(`\\[([^\\]]+)\\]\\((${RESEARCH_REF_PATTERN})\\)`, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const label = match[1]
    const paper = papersByKey.get(match[2])
    if (paper) {
      const paperKey = paper.key
      parts.push(
        <a
          key={key++}
          href={`#${paperAnchor(paperKey)}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            onJump(paperKey)
          }}
          className={LINK_CLASS}
        >
          {label}
        </a>
      )
    } else {
      parts.push(<span key={key++}>{label}</span>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function PaperCard({
  paper,
  highlighted,
  expanded,
  onToggleAbstract,
}: {
  paper: ResearchPaper
  highlighted: boolean
  expanded: boolean
  onToggleAbstract: () => void
}) {
  const meta = [formatAuthors(paper.authors), paper.year, paper.venue].filter(Boolean).join(' · ')
  return (
    <article
      id={paperAnchor(paper.key)}
      className={`scroll-mt-20 rounded-xl border bg-white p-4 transition-shadow ${
        highlighted ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200'
      }`}
    >
      {(paper.core || paper.is_review || paper.is_new) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {paper.is_new && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">新</span>
          )}
          {paper.core && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">核心期刊</span>
          )}
          {paper.is_review && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">综述</span>
          )}
        </div>
      )}
      <h3 className="text-[15px] font-semibold leading-snug text-gray-900">{paper.title_zh || paper.title}</h3>
      {paper.title_zh && <p className="mt-1 text-xs leading-snug text-gray-500">{paper.title}</p>}
      <p className="mt-2 text-xs text-gray-500">
        {meta}
        {paper.cited_by > 0 && <span className="text-gray-400"> · 被引 {paper.cited_by}</span>}
      </p>
      {paper.gist_zh && <p className="mt-2 text-sm leading-relaxed text-gray-700">{paper.gist_zh}</p>}
      {expanded && paper.abstract && (
        <p className="mt-2 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">{paper.abstract}</p>
      )}
      <div className="mt-3 flex items-center gap-4 text-xs">
        {paper.abstract && (
          <button type="button" onClick={onToggleAbstract} className="font-medium text-gray-500 hover:text-gray-900">
            {expanded ? '收起摘要' : '英文摘要'}
          </button>
        )}
        <a
          href={paper.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-600 hover:text-blue-800"
        >
          原文 ↗
        </a>
      </div>
    </article>
  )
}

export default function ResearchPage() {
  const { entries, loaded, saveTopic, removeTopic } = useResearchTopics(supabase)
  const { bookmarks, getSyncLink } = useBookmarks(supabase)
  const [syncLink, setSyncLink] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [current, setCurrent] = useState<ResearchTopicData | null>(null)
  const currentRef = useRef<ResearchTopicData | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('relevance')
  const [showLow, setShowLow] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const runIdRef = useRef(0)

  const updateCurrent = useCallback((next: ResearchTopicData | null) => {
    currentRef.current = next
    setCurrent(next)
  }, [])

  const openTopic = useCallback((topic: string | null) => {
    const url = new URL(window.location.href)
    if (topic) url.searchParams.set('topic', topic)
    else url.searchParams.delete('topic')
    window.history.replaceState({}, '', url.toString())
  }, [])

  // 链接里带 ?topic= 时，打开已保存的那个专题；本地没有的，等云端读回来再打开
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loaded || restoredRef.current || currentRef.current || phase !== 'idle') return
    const topic = new URLSearchParams(window.location.search).get('topic')
    const entry = topic ? entries.find((e) => e.topic === topic) : undefined
    if (!entry) return
    restoredRef.current = true
    updateCurrent(entry.data)
  }, [loaded, entries, phase, updateCurrent])

  const screenPapers = useCallback(async (topic: string, runId: number) => {
    const pending = (currentRef.current?.papers ?? []).filter((p) => p.relevance === undefined)
    if (!pending.length) {
      if (runIdRef.current === runId) setPhase('idle')
      return
    }
    setPhase('screening')
    setProgress({ done: 0, total: pending.length })
    const batches: ResearchPaper[][] = []
    for (let i = 0; i < pending.length; i += SCREEN_BATCH) batches.push(pending.slice(i, i + SCREEN_BATCH))

    let failed = 0
    let next = 0
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++]
        try {
          const data = await postJson('/api/research/screen/', {
            topic,
            papers: batch.map((p) => ({ key: p.key, title: p.title, abstract: p.abstract })),
          })
          if (runIdRef.current !== runId || !currentRef.current) return
          const byKey = new Map<string, { relevance: number; title_zh: string; gist_zh: string }>(
            (data.items ?? []).map((item: { key: string; relevance: number; title_zh: string; gist_zh: string }) => [item.key, item])
          )
          updateCurrent({
            ...currentRef.current,
            papers: currentRef.current.papers.map((p) => {
              const item = byKey.get(p.key)
              return item ? { ...p, relevance: item.relevance, title_zh: item.title_zh || undefined, gist_zh: item.gist_zh || undefined } : p
            }),
          })
        } catch (err) {
          console.error('screen batch error:', err)
          failed += batch.length
        }
        setProgress((prev) => ({ ...prev, done: prev.done + batch.length }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(SCREEN_CONCURRENCY, batches.length) }, worker))
    if (runIdRef.current !== runId || !currentRef.current) return
    saveTopic(topic, currentRef.current)
    setPhase('idle')
    if (failed) setError(`有 ${failed} 篇没能翻译和筛选，可以点「补全翻译」再试。`)
  }, [saveTopic, updateCurrent])

  const runSearch = useCallback(async (raw: string) => {
    const topic = normalizeTopic(raw)
    if (!topic || isStaticSite) return
    const previous = entries.find((e) => e.topic === topic)
    if (!previous && entries.length >= MAX_RESEARCH_TOPICS) {
      setError(`最多保存 ${MAX_RESEARCH_TOPICS} 个专题，先删掉一些再搜新的。`)
      return
    }
    const runId = ++runIdRef.current
    setError('')
    setPhase('searching')
    setNotice('')
    if (!previous) {
      setShowLow(false)
      setExpanded(new Set())
      updateCurrent(null)
    }
    openTopic(topic)
    try {
      // 已有的专题沿用上次的检索式，这样多出来的才真是新发表 / 新收录的
      const request = previous
        ? { topic, queries: previous.data.queries, from_year: previous.data.from_year, to_year: previous.data.to_year }
        : { topic }
      const result = (await postJson('/api/research/search/', request)) as ResearchSearchResult
      if (runIdRef.current !== runId) return
      // 上次筛过的沿用翻译和相关度；上次没有的标「新」；上次有、这次没排进来的也留着，综述里的引用不会断
      const before = new Map((previous?.data.papers ?? []).map((p) => [p.key, p]))
      const found = result.papers.map((p) => {
        const old = before.get(p.key)
        if (old) return { ...p, relevance: old.relevance, title_zh: old.title_zh, gist_zh: old.gist_zh }
        return previous ? { ...p, is_new: true } : p
      })
      const foundKeys = new Set(found.map((p) => p.key))
      const kept = (previous?.data.papers ?? [])
        .filter((p) => !foundKeys.has(p.key))
        .map((p) => ({ ...p, is_new: false }))
      const papers = [...found, ...kept].slice(0, MAX_KEPT_PAPERS)
      const data: ResearchTopicData = {
        ...result,
        papers,
        searched_at: new Date().toISOString(),
        review: previous?.data.review ?? null,
      }
      updateCurrent(data)
      saveTopic(topic, data)
      setInput('')
      const notices: string[] = []
      if (previous) {
        const newCount = papers.filter((p) => p.is_new).length
        notices.push(newCount ? `找到 ${newCount} 篇上次没有的文章，已标「新」。` : '没有发现新文章。')
      }
      if (result.failed_queries) {
        notices.push(`有 ${result.failed_queries} 条检索式这次被文献库限流没查到，结果可能不全，过一会儿点「检查新发表」补齐。`)
      }
      setNotice(notices.join(''))
      if (!papers.length) {
        setPhase('idle')
        return
      }
      await screenPapers(topic, runId)
    } catch (err) {
      if (runIdRef.current !== runId) return
      console.error('research search error:', err)
      setError(failureMessage(err, '检索失败'))
      setPhase('idle')
      if (previous) updateCurrent(previous.data)
      else openTopic(null)
    }
  }, [entries, openTopic, saveTopic, screenPapers, updateCurrent])

  const generateReview = useCallback(async () => {
    const data = currentRef.current
    if (!data || isStaticSite) return
    const runId = ++runIdRef.current
    const chosen = sortPapers(data.papers.filter((p) => relevanceOf(p) >= 1), 'relevance').slice(0, REVIEW_MAX_PAPERS)
    if (!chosen.length) {
      setError('没有相关的文章，没法写综述。换个说法再搜一次试试。')
      return
    }
    setError('')
    setPhase('reviewing')
    try {
      const review = (await postJson('/api/research/review/', {
        topic: data.topic,
        papers: chosen.map((p) => ({
          key: p.key,
          title: p.title,
          title_zh: p.title_zh,
          year: p.year,
          venue: p.venue,
          cited_by: p.cited_by,
          abstract: p.abstract,
          is_review: p.is_review,
        })),
      })) as ResearchReview
      if (runIdRef.current !== runId || !currentRef.current) return
      const next = { ...currentRef.current, review }
      updateCurrent(next)
      saveTopic(next.topic, next)
    } catch (err) {
      if (runIdRef.current !== runId) return
      console.error('research review error:', err)
      setError(failureMessage(err, '综述生成失败'))
    } finally {
      if (runIdRef.current === runId) setPhase('idle')
    }
  }, [saveTopic, updateCurrent])

  const rescreen = useCallback(() => {
    const data = currentRef.current
    if (!data) return
    setError('')
    void screenPapers(data.topic, ++runIdRef.current)
  }, [screenPapers])

  const deleteCurrent = useCallback(() => {
    const data = currentRef.current
    if (!data || !window.confirm(`删除专题「${data.topic}」？`)) return
    runIdRef.current++
    removeTopic(data.topic)
    updateCurrent(null)
    openTopic(null)
    setPhase('idle')
  }, [openTopic, removeTopic, updateCurrent])

  const backToList = useCallback(() => {
    runIdRef.current++
    updateCurrent(null)
    openTopic(null)
    setPhase('idle')
    setError('')
    setNotice('')
  }, [openTopic, updateCurrent])

  const openEntry = useCallback((entry: ResearchEntry) => {
    runIdRef.current++
    setPhase('idle')
    setError('')
    setNotice('')
    setShowLow(false)
    setExpanded(new Set())
    updateCurrent(entry.data)
    openTopic(entry.topic)
    window.scrollTo({ top: 0 })
    if (!isStaticSite && entry.data.papers.some((p) => p.relevance === undefined)) {
      void screenPapers(entry.topic, ++runIdRef.current)
    }
  }, [openTopic, screenPapers, updateCurrent])

  const papersByKey = useMemo(() => new Map((current?.papers ?? []).map((p) => [p.key, p])), [current])
  const groups = useMemo(() => {
    const papers = current?.papers ?? []
    const main = sortPapers(papers.filter((p) => relevanceOf(p) >= 1), sortMode)
    const low = sortPapers(papers.filter((p) => relevanceOf(p) === 0), sortMode)
    return { main, low }
  }, [current, sortMode])
  const unscreened = (current?.papers ?? []).filter((p) => p.relevance === undefined).length

  const jumpToPaper = useCallback((key: string) => {
    const paper = papersByKey.get(key)
    if (paper && relevanceOf(paper) === 0) setShowLow(true)
    setHighlighted(key)
    window.setTimeout(() => {
      document.getElementById(paperAnchor(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    window.setTimeout(() => setHighlighted((h) => (h === key ? null : h)), 2500)
  }, [papersByKey])

  const busy = phase !== 'idle'
  const review = current?.review ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/90 backdrop-blur" aria-label={text.mainNavigation}>
        <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-2 sm:min-h-16 lg:px-8">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
              <Link href="/" title={text.navHomeTip}>{text.brand}</Link>
              <span className="ml-2 font-normal text-gray-400">/ 专题研究</span>
            </h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
            <NavIconButton label={text.navResearchTip} href="/research" icon={<ResearchIcon />} active />
            <NavIconButton label={text.navBrowseTip} href="/browse" icon={<BrowseIcon />} />
            <NavIconButton
              label={text.navFavoritesTip(bookmarks.size)}
              href="/browse/?favorites=1"
              icon={<BookmarkIcon filled={bookmarks.size > 0} />}
              badge={bookmarks.size}
            />
            <NavIconButton
              label={text.navSyncTip}
              onClick={() => setSyncLink(getSyncLink())}
              icon={<SyncIcon />}
              tooltipAlign="right"
            />
          </div>
        </div>
      </nav>

      {syncLink && <SyncDeviceDialog link={syncLink} language="zh" onClose={() => setSyncLink(null)} />}

      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10 lg:max-w-6xl lg:px-8">
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
          {/* 大屏左栏：我的专题，随时切换 */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-1">
              {!isStaticSite && (
                <button
                  type="button"
                  onClick={backToList}
                  className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${
                    current
                      ? 'border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900'
                      : 'border border-blue-200 bg-blue-50 text-blue-700'
                  }`}
                >
                  <span aria-hidden="true">＋</span> 新专题
                </button>
              )}
              <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-gray-400">
                我的专题
                {entries.length > 0 && <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-300">{entries.length}</span>}
              </p>
              {entries.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-gray-400">{loaded ? '搜过的专题会保存在这里，多设备同步。' : '加载中…'}</p>
              ) : (
                <ul className="space-y-0.5">
                  {entries.map((entry) => {
                    const active = current?.topic === entry.topic
                    return (
                      <li key={entry.topic}>
                        <button
                          type="button"
                          onClick={() => openEntry(entry)}
                          disabled={busy && !active}
                          aria-current={active ? 'page' : undefined}
                          className={`block w-full rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                            active ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-white hover:text-gray-900'
                          }`}
                        >
                          <span className="block truncate text-[13px] font-medium">{entry.topic}</span>
                          <span className="mt-0.5 block text-[11px] text-gray-400">
                            {entry.data.papers.length} 篇{entry.data.review ? ' · 有综述' : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {isStaticSite && (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
                备用站不能检索新专题，只能看已保存的。要搜新主题请到主站{' '}
                <a href="https://ecepaper.siyan.me/research/" className="font-medium underline">ecepaper.siyan.me</a>。
              </div>
            )}

            {!current && (
              <>
                <h2 className="mb-3 text-xl font-semibold text-gray-900">想要研究的主题</h2>
                <p className="text-sm leading-relaxed text-gray-600">
                  输入一个想研究的主题，会去学术数据库里找这个主题下已发表的研究，翻译、筛选后列出来，还可以生成一份简短的研究综述。
                </p>
                {!isStaticSite && (
                  <form
                    className="mt-4 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void runSearch(input)
                    }}
                  >
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      aria-label="想要研究的主题"
                      placeholder="例如：游戏中的同伴冲突"
                      maxLength={80}
                      disabled={busy}
                      className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-[15px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
                    />
                    <button
                      type="submit"
                      disabled={busy || !normalizeTopic(input)}
                      className="h-11 flex-shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      {phase === 'searching' ? '检索中…' : '检索'}
                    </button>
                  </form>
                )}
                {!isStaticSite && !busy && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setInput(example)}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-gray-400"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-gray-400">
                  可以写时间范围，如「近10年」「2015年以来」。主要检索英文文献（OpenAlex），中文期刊收录较少。
                </p>
              </>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}

            {notice && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
            )}

            {phase === 'searching' && !current && (
              <div className="py-16 text-center text-sm text-gray-500">正在拟定检索式、检索文献…（大约 10 秒）</div>
            )}

            {!current && !busy && (
              <section className="mt-8 lg:hidden">
                <h2 className="text-sm font-semibold text-gray-900">我的专题</h2>
                {!loaded ? (
                  <p className="mt-3 text-sm text-gray-400">加载中…</p>
                ) : entries.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-400">还没有专题。搜过的专题会保存在这里，多设备同步。</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {entries.map((entry) => (
                      <li key={entry.topic}>
                        <button
                          type="button"
                          onClick={() => openEntry(entry)}
                          className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-gray-900">{entry.topic}</span>
                            <span className="mt-0.5 block text-xs text-gray-500">
                              {entry.data.papers.length} 篇{entry.data.review ? ' · 有综述' : ''} · {formatDate(entry.data.searched_at)}
                            </span>
                          </span>
                          <span className="text-gray-300">›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {current && (
              <>
                <button type="button" onClick={backToList} className="mb-3 text-sm text-gray-500 hover:text-gray-900 lg:hidden">
                  ← 全部专题
                </button>
                <h2 className="text-xl font-semibold leading-snug text-gray-900">{current.topic}</h2>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">
                  {current.papers.length} 篇 · {yearRange(current)} · 来源 {current.source === 'openalex' ? 'OpenAlex' : 'Crossref'} · 检索于{' '}
                  {formatDate(current.searched_at)}
                </p>
                <details className="mt-1 text-xs text-gray-500">
                  <summary className="cursor-pointer select-none">检索式</summary>
                  <ul className="mt-1 space-y-1 break-words font-mono text-[11px] text-gray-500">
                    {current.queries.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </details>
                {!isStaticSite && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runSearch(current.topic)}
                      className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:border-gray-300 disabled:opacity-50"
                    >
                      {phase === 'searching' ? '检查中…' : '检查新发表'}
                    </button>
                    {unscreened > 0 && phase !== 'screening' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={rescreen}
                        className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:border-gray-300 disabled:opacity-50"
                      >
                        补全翻译（{unscreened}）
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={deleteCurrent}
                      className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-red-600 hover:border-red-200 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                )}

                {/* 综述 */}
                <section className="mt-6 rounded-xl border border-blue-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">研究综述</h3>
                    {review && !isStaticSite && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void generateReview()}
                        className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
                      >
                        {phase === 'reviewing' ? '生成中…' : '重新生成'}
                      </button>
                    )}
                  </div>
                  {review ? (
                    <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-gray-800">
                      {review.overview && <p>{renderRefs(review.overview, papersByKey, jumpToPaper)}</p>}
                      {review.themes.map((theme, i) => (
                        <div key={`${i}-${theme.title}`}>
                          <h4 className="font-semibold text-gray-900">
                            {i + 1}. {theme.title}
                          </h4>
                          <p className="mt-1">{renderRefs(theme.body, papersByKey, jumpToPaper)}</p>
                        </div>
                      ))}
                      {review.gaps && (
                        <div>
                          <h4 className="font-semibold text-gray-900">还没回答好的问题</h4>
                          <p className="mt-1">{renderRefs(review.gaps, papersByKey, jumpToPaper)}</p>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">
                        基于 {review.paper_count} 篇相关文章生成于 {formatDate(review.created_at)}，由模型根据标题和摘要归纳，引用前请看原文核实。
                      </p>
                    </div>
                  ) : phase === 'reviewing' ? (
                    <p className="mt-3 text-sm text-gray-500">正在通读这些文章、归纳研究方向…（大约 15 秒）</p>
                  ) : isStaticSite ? (
                    <p className="mt-3 text-sm text-gray-500">这个专题还没有综述。</p>
                  ) : (
                    <div className="mt-3">
                      <p className="text-sm leading-relaxed text-gray-600">
                        把下面相关的文章（最多 {REVIEW_MAX_PAPERS} 篇）归纳成几个研究方向，说明各自的发现和还没解决的问题。
                      </p>
                      <button
                        type="button"
                        disabled={busy || current.papers.length === 0}
                        onClick={() => void generateReview()}
                        className="mt-3 h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300"
                      >
                        {phase === 'screening' ? '等筛选完成…' : '生成综述'}
                      </button>
                    </div>
                  )}
                </section>

                {/* 文章清单 */}
                <section className="mt-8">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">相关文章（{groups.main.length}）</h3>
                    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
                      {([
                        ['relevance', '相关度'],
                        ['newest', '最新'],
                        ['cited', '被引最多'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setSortMode(mode)}
                          className={`rounded-md px-2.5 py-1 ${sortMode === mode ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {phase === 'screening' && (
                    <p className="mt-2 text-xs text-gray-500">
                      正在翻译标题、判断相关度… {progress.done}/{progress.total}
                    </p>
                  )}
                  {current.papers.length === 0 && (
                    <p className="mt-4 text-sm text-gray-500">没有检索到文章。换个说法或放宽时间范围再试试。</p>
                  )}
                  <div className="mt-3 space-y-3">
                    {groups.main.map((paper) => (
                      <PaperCard
                        key={paper.key}
                        paper={paper}
                        highlighted={highlighted === paper.key}
                        expanded={expanded.has(paper.key)}
                        onToggleAbstract={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev)
                            if (next.has(paper.key)) next.delete(paper.key)
                            else next.add(paper.key)
                            return next
                          })
                        }
                      />
                    ))}
                  </div>
                  {groups.low.length > 0 && (
                    <div className="mt-6">
                      <button
                        type="button"
                        onClick={() => setShowLow((v) => !v)}
                        className="text-sm font-medium text-gray-500 hover:text-gray-900"
                      >
                        {showLow ? '收起' : '展开'}可能不太相关的文章（{groups.low.length}）
                      </button>
                      {showLow && (
                        <div className="mt-3 space-y-3 opacity-80">
                          {groups.low.map((paper) => (
                            <PaperCard
                              key={paper.key}
                              paper={paper}
                              highlighted={highlighted === paper.key}
                              expanded={expanded.has(paper.key)}
                              onToggleAbstract={() =>
                                setExpanded((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(paper.key)) next.delete(paper.key)
                                  else next.add(paper.key)
                                  return next
                                })
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
            <InterestDigestArchive client={supabase} />
          </div>
        </div>
      </main>
    </div>
  )
}
