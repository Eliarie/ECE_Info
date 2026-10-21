'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { UI_TEXT } from '@/lib/i18n'
import { useBookmarks } from '@/lib/useBookmarks'
import { MAX_INTERESTS, normalizeInterest, useInterestDigests } from '@/lib/useInterestDigests'
import type { Article, DigestHighlight, DisplayLanguage, WeeklyDigest } from '@/lib/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const DISPLAY_LANGUAGE_KEY = 'article_display_language'
const ACTIVE_INTEREST_KEY = 'digest_active_interest'

type LinkableArticle = Pick<Article, 'id' | 'source_url'>

const formatPeriod = (from: string, to: string, language: DisplayLanguage) => {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const fromDate = new Date(`${from}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const toDate = new Date(`${to}T00:00:00`).toLocaleDateString(
    locale,
    language === 'zh' ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
  return `${fromDate} — ${toDate}`
}

const weekEndOf = (weekStart: string) => {
  const date = new Date(`${weekStart}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 6)
  return date.toISOString().slice(0, 10)
}

const DIGEST_WEEKS_LIMIT = 52 // 期数下拉框最多列出最近一年

// 按 article_ids 的顺序取回该期论文，编号 1..N 才能和概览里的 [短语](编号) 对上
const fetchDigestArticles = async (row: WeeklyDigest): Promise<Article[]> => {
  const ids = Array.isArray(row.article_ids) ? row.article_ids : []
  if (!supabase || ids.length === 0) return []
  const { data, error } = await supabase.from('articles').select('*').in('id', ids)
  if (error) {
    console.error('digest articles query error:', error)
    return []
  }
  const order = new Map(ids.map((id, i) => [id, i]))
  return ((data ?? []) as Article[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

const toParagraphs = (value: string | null | undefined) =>
  (value ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean)

const OVERVIEW_LINK_CLASS =
  'text-blue-700 underline decoration-blue-300/70 underline-offset-[3px] transition-colors hover:text-blue-900 hover:decoration-blue-500'

const paperAnchorId = (articleId: string) => `paper-${articleId}`

// 概览里的 [短语](编号)：本期论文里有对应卡片就页内跳转，否则退回到原文链接
function renderOverviewLinks(
  text: string,
  orderedArticles: (LinkableArticle | undefined)[],
  cardIds: Set<string>,
  onJump: (articleId: string) => void
): ReactNode {
  const parts: ReactNode[] = []
  const regex = /\[([^\]]+)\]\((\d+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const label = match[1]
    const num = parseInt(match[2], 10)
    const article = orderedArticles[num - 1]
    if (article && cardIds.has(article.id)) {
      const articleId = article.id
      parts.push(
        <a
          key={key++}
          href={`#${paperAnchorId(articleId)}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            onJump(articleId)
          }}
          className={OVERVIEW_LINK_CLASS}
        >
          {label}
        </a>
      )
    } else if (article?.source_url) {
      parts.push(
        <a
          key={key++}
          href={article.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className={OVERVIEW_LINK_CLASS}
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

type HighlightWithArticle = DigestHighlight & { article?: Article }

export default function HomePage() {
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>('zh')
  // latestDigest：最新一期，兴趣速览总是基于它生成；digest / articles：页面上正在看的那一期
  const [latestDigest, setLatestDigest] = useState<WeeklyDigest | null>(null)
  const [digest, setDigest] = useState<WeeklyDigest | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [digestWeeks, setDigestWeeks] = useState<string[]>([])
  const [pendingWeek, setPendingWeek] = useState<string | null>(null) // 正在加载的那一期，下拉框先停在它上面
  const switchingWeek = pendingWeek !== null
  const [weekLoadFailed, setWeekLoadFailed] = useState(false)
  const digestCacheRef = useRef<Map<string, { digest: WeeklyDigest; articles: Article[] }>>(new Map())
  const weekRequestRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const text = UI_TEXT[displayLanguage]
  const { bookmarks, toggleBookmark } = useBookmarks(supabase)

  const { entries: interestEntries, loaded: interestsLoaded, saveDigest, removeInterest } = useInterestDigests(supabase)
  const [interestInput, setInterestInput] = useState('')
  const [activeInterest, setActiveInterest] = useState<string | null>(null)
  const [activeWeek, setActiveWeek] = useState<string | null>(null) // null = 该兴趣最新一期
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(new Set())
  const [interestError, setInterestError] = useState<'failed' | 'limit' | null>(null)
  const attemptedRef = useRef<Set<string>>(new Set()) // 本次打开页面已尝试生成过的「兴趣|周」
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set())
  const [archiveArticles, setArchiveArticles] = useState<{ week: string; list: (LinkableArticle | undefined)[] } | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem(DISPLAY_LANGUAGE_KEY)
    if (saved === 'zh' || saved === 'en') setDisplayLanguage(saved)
  }, [])

  useEffect(() => {
    document.documentElement.lang = displayLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = text.brand
  }, [displayLanguage, text.brand])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    const client = supabase
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const [latestResult, weeksResult] = await Promise.all([
        client.from('weekly_digests').select('*').order('week_start', { ascending: false }).limit(1),
        client.from('weekly_digests').select('week_start').order('week_start', { ascending: false }).limit(DIGEST_WEEKS_LIMIT),
      ])
      if (cancelled) return
      if (latestResult.error) {
        console.error('weekly_digests query error:', latestResult.error)
        setLoading(false)
        return
      }
      if (weeksResult.error) console.error('digest weeks query error:', weeksResult.error)
      const latest = ((latestResult.data ?? [])[0] ?? null) as WeeklyDigest | null
      const list = latest ? await fetchDigestArticles(latest) : []
      if (cancelled) return
      if (latest) {
        digestCacheRef.current.set(latest.week_start, { digest: latest, articles: list })
        const weeks = (weeksResult.data ?? []).map((row) => row.week_start as string)
        setDigestWeeks(weeks.includes(latest.week_start) ? weeks : [latest.week_start, ...weeks])
      }
      setLatestDigest(latest)
      setDigest(latest)
      setArticles(list)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // 切换正在看的那一期；看过的期数缓存在本页，来回切不重复请求
  const selectDigestWeek = useCallback(async (week: string) => {
    if (!supabase) return
    const requestId = ++weekRequestRef.current
    setWeekLoadFailed(false)
    const cached = digestCacheRef.current.get(week)
    if (cached) {
      setPendingWeek(null)
      setDigest(cached.digest)
      setArticles(cached.articles)
      return
    }
    setPendingWeek(week)
    const { data, error } = await supabase.from('weekly_digests').select('*').eq('week_start', week).maybeSingle()
    const row = data as WeeklyDigest | null
    const list = row ? await fetchDigestArticles(row) : []
    if (requestId !== weekRequestRef.current) return // 期间又切到了别的期
    setPendingWeek(null)
    if (error || !row) {
      if (error) console.error('weekly_digests week query error:', error)
      setWeekLoadFailed(true)
      return
    }
    digestCacheRef.current.set(week, { digest: row, articles: list })
    setDigest(row)
    setArticles(list)
  }, [])

  const changeDisplayLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language)
    try { localStorage.setItem(DISPLAY_LANGUAGE_KEY, language) } catch {}
  }

  const selectInterest = useCallback((interest: string) => {
    setActiveInterest(interest)
    setActiveWeek(null)
    setInterestError(null)
    try { localStorage.setItem(ACTIVE_INTEREST_KEY, interest) } catch {}
  }, [])

  const generateFor = useCallback(async (interest: string) => {
    setGeneratingSet((prev) => new Set(prev).add(interest))
    try {
      const resp = await fetch('/api/generate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) throw new Error(data.error || 'failed')
      saveDigest(interest, {
        week_start: data.week_start,
        overview_zh: data.overview_zh,
        overview_en: data.overview_en || '',
      })
      return true
    } catch (error) {
      console.error('interest generate error:', error)
      return false
    } finally {
      setGeneratingSet((prev) => {
        const next = new Set(prev)
        next.delete(interest)
        return next
      })
    }
  }, [saveDigest])

  const submitInterest = async () => {
    const value = normalizeInterest(interestInput)
    if (!value || !latestDigest) return
    const exists = interestEntries.some((e) => e.interest === value)
    if (!exists && interestEntries.length >= MAX_INTERESTS) {
      setInterestError('limit')
      return
    }
    selectInterest(value)
    setInterestInput('')
    if (exists) return // 已订阅：切过去即可，缺本周的话下面的自动生成会补上
    attemptedRef.current.add(`${value}|${latestDigest.week_start}`)
    if (!(await generateFor(value))) {
      setInterestError('failed')
      setInterestInput(value)
    }
  }

  const deleteInterest = (interest: string) => {
    if (!window.confirm(text.digestInterestDeleteConfirm(interest))) return
    removeInterest(interest)
  }

  // 当前选中的兴趣不存在（首次打开、被删除、生成失败）时，回到上次看的或最近添加的那个
  useEffect(() => {
    if (activeInterest && (interestEntries.some((e) => e.interest === activeInterest) || generatingSet.has(activeInterest))) return
    let stored: string | null = null
    try { stored = localStorage.getItem(ACTIVE_INTEREST_KEY) } catch {}
    const fallback = interestEntries.find((e) => e.interest === stored) ?? interestEntries[interestEntries.length - 1]
    setActiveInterest(fallback?.interest ?? null)
    setActiveWeek(null)
  }, [activeInterest, interestEntries, generatingSet])

  // 每个已订阅的兴趣缺本周速览时自动补生成：先补正在看的，其余逐个在后台补
  useEffect(() => {
    if (!latestDigest || !interestsLoaded || generatingSet.size > 0) return
    const week = latestDigest.week_start
    const stale = interestEntries.filter(
      (e) => !e.digests.some((d) => d.week_start === week) && !attemptedRef.current.has(`${e.interest}|${week}`)
    )
    if (stale.length === 0) return
    const next = stale.find((e) => e.interest === activeInterest) ?? stale[0]
    const key = `${next.interest}|${week}`
    attemptedRef.current.add(key)
    void generateFor(next.interest).then((ok) => {
      if (!ok) setFailedKeys((prev) => new Set(prev).add(key))
    })
  }, [latestDigest, interestsLoaded, interestEntries, activeInterest, generatingSet, failedKeys, generateFor])

  const retryThisWeek = (interest: string) => {
    if (!latestDigest) return
    const key = `${interest}|${latestDigest.week_start}`
    attemptedRef.current.delete(key)
    setFailedKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const viewingLatest = !digest || !latestDigest || digest.week_start === latestDigest.week_start

  const orderedArticles = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.article_ids ?? []).map((id) => byId.get(id))
  }, [articles, digest])

  const highlights: HighlightWithArticle[] = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.highlights ?? []).map((h) => ({ ...h, article: byId.get(h.article_id) }))
  }, [digest, articles])

  const cardIds = useMemo(() => new Set(highlights.map((h) => h.article_id)), [highlights])

  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)

  const scrollToPaper = useCallback((articleId: string, smooth: boolean) => {
    const el = document.getElementById(paperAnchorId(articleId))
    if (!el) return false
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: smooth && !reduceMotion ? 'smooth' : 'auto', block: 'start' })
    el.focus({ preventScroll: true })
    setFlashId(articleId)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashId(null), 2200)
    return true
  }, [])

  // 写入 #paper-xxx，浏览器“返回”可回到概览原位置，链接也能直接分享
  const jumpToPaper = useCallback((articleId: string) => {
    if (scrollToPaper(articleId, true)) {
      window.history.pushState(window.history.state, '', `#${paperAnchorId(articleId)}`)
    }
  }, [scrollToPaper])

  // 带 #paper-xxx 打开页面时，卡片是异步加载的，加载完成后再定位
  const initialHashHandled = useRef(false)
  useEffect(() => {
    if (initialHashHandled.current || cardIds.size === 0) return
    initialHashHandled.current = true
    const hash = decodeURIComponent(window.location.hash.slice(1))
    if (!hash.startsWith('paper-')) return
    const articleId = hash.slice('paper-'.length)
    if (cardIds.has(articleId)) requestAnimationFrame(() => scrollToPaper(articleId, false))
  }, [cardIds, scrollToPaper])

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
  }, [])

  const overview = displayLanguage === 'zh'
    ? digest?.summary_zh
    : (digest?.summary_en || digest?.summary_zh)

  const overviewParagraphs = useMemo(() => toParagraphs(overview), [overview])

  const activeEntry = interestEntries.find((e) => e.interest === activeInterest) ?? null
  const shownInterestDigest = activeEntry
    ? (activeWeek && activeEntry.digests.find((d) => d.week_start === activeWeek)) || activeEntry.digests[0] || null
    : null
  const shownWeek = shownInterestDigest?.week_start ?? null
  // 兴趣速览和下方正在看的是同一期：[短语](编号) 可以页内跳到卡片；否则单独取那一期清单，链接指向原文
  const interestOnViewedWeek = Boolean(digest && shownWeek === digest.week_start)
  const activeGenerating = Boolean(activeInterest && generatingSet.has(activeInterest))
  const activeMissingThisWeek = Boolean(
    latestDigest && activeInterest && !activeEntry?.digests.some((d) => d.week_start === latestDigest.week_start)
  )
  const activeFailedThisWeek = Boolean(
    latestDigest && activeInterest && activeMissingThisWeek && failedKeys.has(`${activeInterest}|${latestDigest.week_start}`)
  )

  const interestParagraphs = useMemo(() => toParagraphs(
    displayLanguage === 'zh'
      ? shownInterestDigest?.overview_zh
      : (shownInterestDigest?.overview_en || shownInterestDigest?.overview_zh)
  ), [shownInterestDigest, displayLanguage])

  // 往期速览的 [短语](编号) 对应的是那一周的论文清单，单独取来，链接指向原文
  useEffect(() => {
    if (!supabase || !shownWeek || interestOnViewedWeek || archiveArticles?.week === shownWeek) return
    const cached = digestCacheRef.current.get(shownWeek)
    if (cached) {
      const byId = new Map(cached.articles.map((a) => [a.id, a]))
      setArchiveArticles({ week: shownWeek, list: cached.digest.article_ids.map((id) => byId.get(id)) })
      return
    }
    let cancelled = false
    const loadArchive = async () => {
      const { data, error } = await supabase
        .from('weekly_digests')
        .select('article_ids')
        .eq('week_start', shownWeek)
        .maybeSingle()
      if (error) console.error('archive digest query error:', error)
      const ids = ((data?.article_ids ?? []) as string[])
      let byId = new Map<string, LinkableArticle>()
      if (ids.length > 0) {
        const { data: rows, error: rowsError } = await supabase.from('articles').select('id,source_url').in('id', ids)
        if (rowsError) console.error('archive articles query error:', rowsError)
        byId = new Map((rows ?? []).map((a) => [a.id, a]))
      }
      if (!cancelled) setArchiveArticles({ week: shownWeek, list: ids.map((id) => byId.get(id)) })
    }
    void loadArchive()
    return () => { cancelled = true }
  }, [shownWeek, interestOnViewedWeek, archiveArticles?.week])

  const noCards = useMemo(() => new Set<string>(), [])
  const interestArticles = interestOnViewedWeek
    ? orderedArticles
    : (archiveArticles?.week === shownWeek ? archiveArticles.list : [])

  const weekLabel = (weekStart: string) => {
    const period = formatPeriod(weekStart, weekEndOf(weekStart), displayLanguage)
    return latestDigest && weekStart === latestDigest.week_start ? `${text.digestLatestWeek} · ${period}` : period
  }

  const articleTitle = (a: Article | undefined) => {
    if (!a) return ''
    return displayLanguage === 'zh'
      ? a.title_zh || a.title_original
      : a.title_original || a.title_zh || ''
  }
  const articleDate = (a: Article | undefined) =>
    a?.published_at
      ? new Date(a.published_at).toLocaleDateString(displayLanguage === 'zh' ? 'zh-CN' : 'en-US')
      : null

  return (
    <div className="min-h-screen bg-gray-50">
      <nav
        className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/90 backdrop-blur"
        aria-label={text.mainNavigation}
      >
        <div className="mx-auto flex min-h-14 max-w-3xl items-center gap-3 px-4 py-2 sm:min-h-16">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
              {text.brand}
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-gray-500 sm:block">{text.subtitle}</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              href="/browse/?favorites=1"
              aria-label={text.viewFavorites(bookmarks.size)}
              title={text.favorites}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 sm:px-3"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={bookmarks.size > 0 ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                className={bookmarks.size > 0 ? 'text-amber-500' : ''}
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span className="hidden sm:inline">{text.favorites}</span>
              {bookmarks.size > 0 && (
                <span className="min-w-4 text-center text-[11px] text-gray-400">{bookmarks.size}</span>
              )}
            </Link>

            <Link
              href="/browse"
              className="flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
            >
              {text.digestBrowse}
            </Link>

            <div
              className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5"
              role="group"
              aria-label={text.interfaceLanguage}
            >
              {([
                ['zh', '中文', '中'],
                ['en', 'English', '英'],
              ] as const).map(([value, label, shortLabel]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeDisplayLanguage(value)}
                  aria-pressed={displayLanguage === value}
                  aria-label={text.useLanguage(label)}
                  title={label}
                  className={`h-8 w-8 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    displayLanguage === value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {shortLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {loading ? (
          <div className="py-24 text-center text-sm text-gray-400">{text.loading}</div>
        ) : !hasSupabaseEnv ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">{text.missingEnvTitle}</p>
            <p className="mt-2">{text.missingEnvBody}</p>
          </div>
        ) : !digest ? (
          <div className="py-24 text-center">
            <p className="text-sm text-gray-500">{text.digestEmpty}</p>
            <Link
              href="/browse"
              className="mt-5 inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {text.digestBrowse} →
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  viewingLatest ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {viewingLatest ? text.digestTitle : text.digestPastTitle}
              </span>
              {digestWeeks.length > 1 && (
                <select
                  value={pendingWeek ?? digest.week_start}
                  onChange={(e) => void selectDigestWeek(e.target.value)}
                  aria-label={text.digestWeekSelect}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {digestWeeks.map((week) => (
                    <option key={week} value={week}>{weekLabel(week)}</option>
                  ))}
                </select>
              )}
              {!viewingLatest && latestDigest && (
                <button
                  type="button"
                  onClick={() => void selectDigestWeek(latestDigest.week_start)}
                  className="h-8 rounded-lg px-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 hover:text-blue-900"
                >
                  {text.digestBackToLatest}
                </button>
              )}
              {switchingWeek && <span className="text-xs text-gray-400">{text.loading}</span>}
            </div>
            {weekLoadFailed && <p className="mt-2 text-sm text-red-600">{text.digestWeekLoadFailed}</p>}
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              {formatPeriod(digest.week_start, digest.week_end, displayLanguage)}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {(viewingLatest ? text.digestCount : text.digestCountPast)(digest.article_count || orderedArticles.length)}
              <span className="mx-1.5 text-gray-300">·</span>
              {displayLanguage === 'zh' ? 'AI 自动生成' : 'AI-generated'}
            </p>

            {/* 兴趣生成 */}
            <form
              className="mt-6 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submitInterest()
              }}
            >
              <div className="relative flex-1">
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  maxLength={60}
                  placeholder={text.digestInterestPlaceholder}
                  aria-label={text.digestInterestPlaceholder}
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="submit"
                disabled={!normalizeInterest(interestInput) || generatingSet.has(normalizeInterest(interestInput))}
                className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {text.digestInterestGenerate}
              </button>
            </form>

            {interestError && (
              <p className="mt-3 text-sm text-red-600">
                {interestError === 'limit' ? text.digestInterestLimit(MAX_INTERESTS) : text.digestInterestError}
              </p>
            )}

            {/* 我的兴趣：每个兴趣一个标签，点哪个看哪个 */}
            {(interestEntries.length > 0 || activeGenerating) && (
              <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={text.digestInterestList}>
                {[
                  ...interestEntries.map((e) => e.interest),
                  ...(activeInterest && !activeEntry && activeGenerating ? [activeInterest] : []),
                ].map((name) => {
                  const active = name === activeInterest
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => selectInterest(name)}
                      aria-pressed={active}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                      }`}
                    >
                      {name}
                      {generatingSet.has(name) && (
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 animate-pulse rounded-full ${active ? 'bg-white' : 'bg-blue-500'}`}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 兴趣概览 */}
            {activeInterest && (activeEntry || activeGenerating) && (
              <section className="mt-6 rounded-xl border border-blue-100 bg-blue-50/50 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-blue-600">
                    {text.digestInterestSectionTitle(activeInterest)}
                  </h3>
                  {activeEntry && (
                    <div className="flex items-center gap-2">
                      {activeEntry.digests.length > 0 && (
                        <select
                          value={shownWeek ?? ''}
                          onChange={(e) => setActiveWeek(e.target.value)}
                          aria-label={text.digestInterestWeek}
                          className="h-8 rounded-lg border border-blue-100 bg-white px-2 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        >
                          {activeEntry.digests.map((d) => (
                            <option key={d.week_start} value={d.week_start}>{weekLabel(d.week_start)}</option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteInterest(activeEntry.interest)}
                        className="h-8 rounded-lg px-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white hover:text-red-600"
                      >
                        {text.digestInterestDelete}
                      </button>
                    </div>
                  )}
                </div>

                {activeGenerating && activeMissingThisWeek && (
                  <p className="mt-3 text-sm text-gray-500">{text.digestInterestGeneratingWeek}</p>
                )}
                {!activeGenerating && activeFailedThisWeek && activeInterest && (
                  <p className="mt-3 text-sm text-red-600">
                    {text.digestInterestWeekFailed}
                    <button
                      type="button"
                      onClick={() => retryThisWeek(activeInterest)}
                      className="ml-2 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                    >
                      {text.digestInterestRetry}
                    </button>
                  </p>
                )}

                {interestParagraphs.length > 0 && (
                  <div className="mt-3 space-y-4">
                    {interestParagraphs.map((paragraph, i) => (
                      <p key={i} className="text-[16px] leading-8 text-gray-800">
                        {renderOverviewLinks(
                          paragraph,
                          interestArticles,
                          interestOnViewedWeek ? cardIds : noCards,
                          jumpToPaper
                        )}
                      </p>
                    ))}
                  </div>
                )}

                {shownInterestDigest && !interestOnViewedWeek && (
                  <p className="mt-4 text-xs text-gray-400">{text.digestInterestArchiveNote}</p>
                )}
              </section>
            )}

            {/* 正在看的这一期：切换期数时先淡出旧内容 */}
            <div aria-busy={switchingWeek} className={`transition-opacity ${switchingWeek ? 'opacity-50' : ''}`}>
              {/* 综合概览 */}
              <section className="mt-10">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  {viewingLatest ? text.digestOverviewTitle : text.digestOverviewTitlePast}
                </h3>
                <div className="mt-4 space-y-4">
                  {overviewParagraphs.map((paragraph, i) => (
                    <p key={i} className="text-[16px] leading-8 text-gray-800">
                      {renderOverviewLinks(paragraph, orderedArticles, cardIds, jumpToPaper)}
                    </p>
                  ))}
                </div>
                <p className="mt-5 text-xs text-gray-400">{text.digestDisclaimer}</p>
              </section>

              {/* 分隔 */}
              <hr className="my-10 border-gray-200" />

              {/* 本期内容 */}
              <section>
                <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  {viewingLatest ? text.digestHighlightsTitle : text.digestHighlightsTitlePast}
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                    {digest.article_count || highlights.length}
                  </span>
                </h3>

                {highlights.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-400">
                    {text.digestEmpty}
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {highlights.map((h) => {
                      const title = articleTitle(h.article)
                      const date = articleDate(h.article)
                      const result = displayLanguage === 'zh' ? h.result_zh : (h.result_en || h.result_zh)
                      const core = displayLanguage === 'zh' ? h.core_zh : (h.core_en || h.core_zh)
                      const saved = bookmarks.has(h.article_id)
                      return (
                        <article
                          key={h.article_id}
                          id={paperAnchorId(h.article_id)}
                          tabIndex={-1}
                          className={`scroll-mt-24 rounded-xl border p-5 transition-all duration-500 focus:outline-none ${
                            flashId === h.article_id
                              ? 'border-blue-400 bg-blue-50/60 shadow-md ring-2 ring-blue-200'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            {h.article?.source_url ? (
                              <a
                                href={h.article.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[15px] font-semibold leading-snug text-blue-700 underline decoration-blue-300/70 underline-offset-[3px] transition-colors hover:text-blue-900 hover:decoration-blue-500"
                              >
                                {title}
                              </a>
                            ) : (
                              <span className="text-[15px] font-semibold leading-snug text-gray-900">{title}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleBookmark(h.article_id)}
                              aria-pressed={saved}
                              aria-label={saved ? text.removeBookmark : text.addBookmark}
                              title={saved ? text.removeBookmark : text.addBookmark}
                              className={`-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                saved
                                  ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600'
                                  : 'text-gray-300 hover:bg-gray-50 hover:text-gray-500'
                              }`}
                            >
                              <svg
                                aria-hidden="true"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill={saved ? 'currentColor' : 'none'}
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                              </svg>
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-gray-400">
                            {h.article?.source_name}
                            {date ? ` · ${date}` : ''}
                          </p>
                          <div className="mt-3 space-y-2">
                            {result && (
                              <p className="text-sm leading-relaxed text-gray-700">
                                <span className="mr-1.5 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                  {text.digestResult}
                                </span>
                                {result}
                              </p>
                            )}
                            {core && (
                              <p className="text-sm leading-relaxed text-gray-700">
                                <span className="mr-1.5 inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                                  {text.digestCore}
                                </span>
                                {core}
                              </p>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
