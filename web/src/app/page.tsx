'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import TabBar from '@/components/TabBar'
import ArticleCard from '@/components/ArticleCard'
import Pagination from '@/components/Pagination'
import { getTopicLabel, TOPICS, UI_TEXT } from '@/lib/i18n'
import type { Article, DisplayLanguage, Module, Region } from '@/lib/types'
import coreJournals from '@/config/core-journals.json'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const PAGE_SIZE = 8
const BOOKMARK_DEVICE_KEY = 'bookmark_device_id'
const DISPLAY_LANGUAGE_KEY = 'article_display_language'

type CoreJournalConfig = {
  global?: string[]
  domestic?: string[]
  international?: string[]
}

const normalizeJournalList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

const mergeJournalList = (base: string[], extra: string[]) => {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of [...base, ...extra]) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

const buildCoreJournalSetByRegion = (): Record<Region, Set<string>> => {
  // 兼容旧版数组配置
  if (Array.isArray(coreJournals)) {
    const all = new Set(normalizeJournalList(coreJournals))
    return { domestic: all, international: all }
  }

  const cfg = coreJournals as CoreJournalConfig
  const globalList = normalizeJournalList(cfg.global)
  return {
    domestic: new Set(mergeJournalList(globalList, normalizeJournalList(cfg.domestic))),
    international: new Set(mergeJournalList(globalList, normalizeJournalList(cfg.international))),
  }
}

// 核心期刊优先排序：名单由配置文件驱动（按国内/国际分开）
const CORE_JOURNAL_NAMES_BY_REGION = buildCoreJournalSetByRegion()

const getBookmarkDeviceId = () => {
  let deviceId = localStorage.getItem(BOOKMARK_DEVICE_KEY)
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(BOOKMARK_DEVICE_KEY, deviceId)
  }
  return deviceId
}

export default function HomePage() {
  const [module, setModule] = useState<Module>('research_frontier')
  const [region, setRegion] = useState<Region>('international')
  const [articles, setArticles] = useState<Article[]>([])
  const [configuredSources, setConfiguredSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const [favoriteArticles, setFavoriteArticles] = useState<Article[]>([])
  const [favoritesLoading, setFavoritesLoading] = useState(false)
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false)
  const [topicsOpen, setTopicsOpen] = useState(false)
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>('zh')
  const text = UI_TEXT[displayLanguage]
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null)
  const resultsTopRef = useRef<HTMLDivElement | null>(null)
  const bookmarkDeviceIdRef = useRef<string | null>(null)
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('bookmarks')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  useEffect(() => {
    const savedLanguage = localStorage.getItem(DISPLAY_LANGUAGE_KEY)
    if (savedLanguage === 'zh' || savedLanguage === 'en') {
      setDisplayLanguage(savedLanguage)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = displayLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = text.brand
  }, [displayLanguage, text.brand])

  useEffect(() => {
    if (!supabase) { setArticles([]); setLoading(false); return }
    setLoading(true)
    setSearch('')
    setSourceFilter('')
    setSourceDropdownOpen(false)
    setTopicsOpen(false)
    setPage(1)
    setActiveTopic(null)
    const articlesRequest = supabase
      .from('articles')
      .select('*')
      .eq('module', module)
      .eq('region', region)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(500)

    const sourcesRequest = supabase
      .from('sources')
      .select('name')
      .eq('module', module)
      .eq('region', region)
      .eq('is_active', true)
      .order('name')

    Promise.all([articlesRequest, sourcesRequest]).then(([articleResult, sourceResult]) => {
      const { data, error } = articleResult
      if (error) {
        console.error('Supabase query error:', error)
        setArticles([])
        setConfiguredSources([])
        setLoading(false)
        return
      }
      if (sourceResult.error) {
        console.error('Supabase sources query error:', sourceResult.error)
        setConfiguredSources([])
      } else {
        setConfiguredSources((sourceResult.data ?? []).map((source) => source.name).filter(Boolean))
      }
      // 客户端排序：发布时间降序 -> 核心期刊优先 -> 引用数降序
      const sorted = (data ?? []).sort((a, b) => {
        const ta = a.published_at ? new Date(a.published_at).getTime() : 0
        const tb = b.published_at ? new Date(b.published_at).getTime() : 0
        if (tb !== ta) return tb - ta

        const coreSet = CORE_JOURNAL_NAMES_BY_REGION[region]
        const aCore = coreSet.has(a.source_name)
        const bCore = coreSet.has(b.source_name)
        if (aCore !== bCore) return aCore ? -1 : 1

        const ca = (a as any).cited_by_count ?? 0
        const cb = (b as any).cited_by_count ?? 0
        return cb - ca
      })
      setArticles(sorted)
      setLoading(false)
    })
  }, [module, region])

  useEffect(() => {
    if (!supabase) return
    try {
      const deviceId = getBookmarkDeviceId()
      bookmarkDeviceIdRef.current = deviceId
      for (const articleId of bookmarks) {
        void supabase.rpc('set_article_saved', {
          p_device_id: deviceId,
          p_article_id: articleId,
          p_saved: true,
        }).then(({ error }) => {
          if (error) console.error('Supabase bookmark sync error:', error)
        })
      }
    } catch (error) {
      console.error('Bookmark device initialization error:', error)
    }
  }, [])

  useEffect(() => {
    if (!showFavorites) return
    if (!supabase || bookmarks.size === 0) {
      setFavoriteArticles([])
      setFavoritesLoading(false)
      return
    }

    setFavoritesLoading(true)
    supabase
      .from('articles')
      .select('*')
      .in('id', Array.from(bookmarks))
      .order('published_at', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('Supabase favorites query error:', error)
          setFavoriteArticles([])
          setFavoritesLoading(false)
          return
        }
        setFavoriteArticles(data ?? [])
        setFavoritesLoading(false)
      })
  }, [showFavorites, bookmarks])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!sourceDropdownRef.current) return
      if (!sourceDropdownRef.current.contains(event.target as Node)) {
        setSourceDropdownOpen(false)
      }
    }

    if (sourceDropdownOpen) {
      document.addEventListener('mousedown', onClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [sourceDropdownOpen])

  const toggleBookmark = (id: string) => {
    const next = new Set(bookmarks)
    const shouldSave = !next.has(id)
    if (shouldSave) next.add(id)
    else next.delete(id)
    setBookmarks(next)
    try { localStorage.setItem('bookmarks', JSON.stringify(Array.from(next))) } catch {}

    const deviceId = bookmarkDeviceIdRef.current
    if (supabase && deviceId) {
      void supabase.rpc('set_article_saved', {
        p_device_id: deviceId,
        p_article_id: id,
        p_saved: shouldSave,
      }).then(({ error }) => {
        if (error) console.error('Supabase bookmark sync error:', error)
      })
    }
  }

  const changeDisplayLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language)
    try { localStorage.setItem(DISPLAY_LANGUAGE_KEY, language) } catch {}
  }

  // 侧边栏：统计每个主题在当前列表中的文章数
  const topicCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of articles) {
      for (const tag of (a.topic_tags ?? [])) {
        map.set(tag, (map.get(tag) ?? 0) + 1)
      }
    }
    return map
  }, [articles])

  const sources = useMemo(() => {
    const set = new Set([
      ...configuredSources,
      ...articles.map((a) => a.source_name).filter(Boolean),
    ])
    return Array.from(set).sort()
  }, [articles, configuredSources])

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const article of articles) {
      counts.set(article.source_name, (counts.get(article.source_name) ?? 0) + 1)
    }
    return counts
  }, [articles])

  const baseList = useMemo(() => {
    if (showFavorites) return favoriteArticles.filter((a) => bookmarks.has(a.id))
    return articles
  }, [showFavorites, articles, bookmarks, favoriteArticles])

  const filtered = useMemo(() => {
    let list = baseList
    if (showFavorites) {
      list = list.filter((a) => a.module === module && a.region === region)
    }
    // 收藏模式下直接展示全部收藏，不按分类/来源/搜索筛选
    if (!showFavorites && activeTopic) list = list.filter((a) => (a.topic_tags ?? []).includes(activeTopic))
    if (!showFavorites && sourceFilter) list = list.filter((a) => a.source_name === sourceFilter)
    if (!showFavorites && search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (a) =>
          (a.title_zh ?? '').toLowerCase().includes(q) ||
          (a.title_original ?? '').toLowerCase().includes(q) ||
          (a.abstract_zh ?? '').toLowerCase().includes(q) ||
          (a.abstract_original ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [baseList, activeTopic, sourceFilter, search, showFavorites, module, region])

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const scrollToResultsStart = () => {
    requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      resultsTopRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  const enterFavorites = () => {
    setShowFavorites(true)
    setTopicsOpen(false)
    setActiveTopic(null)
    setSourceFilter('')
    setSearch('')
    setSourceDropdownOpen(false)
    setPage(1)
  }

  const exitFavorites = () => {
    setShowFavorites(false)
    setPage(1)
  }

  const handleTopicClick = (t: string) => {
    setActiveTopic((prev) => (prev === t ? null : t))
    setTopicsOpen(false)
    setPage(1)
    setShowFavorites(false)
    scrollToResultsStart()
  }

  const handleAllTopicsClick = () => {
    setActiveTopic(null)
    setTopicsOpen(false)
    setPage(1)
    setShowFavorites(false)
    scrollToResultsStart()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur" aria-label={text.mainNavigation}>
        <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-3 px-4 py-2 sm:min-h-16">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">
              <span className="sm:hidden">{text.brandCompact}</span>
              <span className="hidden sm:inline">{text.brand}</span>
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-gray-500 lg:block">
              {text.subtitle}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3 sm:gap-5">
            <button
              type="button"
              onClick={() => {
                if (showFavorites) exitFavorites()
                else enterFavorites()
              }}
              aria-pressed={showFavorites}
              aria-label={showFavorites ? text.backToArticles : text.viewFavorites(bookmarks.size)}
              title={showFavorites ? text.backToArticles : text.favorites}
              className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3 ${
                showFavorites
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={showFavorites ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span className="hidden sm:inline">{text.favorites}</span>
              {bookmarks.size > 0 && (
                <span className={`min-w-4 text-center text-[11px] ${showFavorites ? 'text-amber-700' : 'text-gray-400'}`}>
                  {bookmarks.size}
                </span>
              )}
            </button>

            <div
              className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5"
              role="group"
              aria-label={text.interfaceLanguage}
            >
              {([
                ['zh', '中文', '中'],
                ['en', 'English', 'EN'],
              ] as const).map(([value, label, compactLabel]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeDisplayLanguage(value)}
                  aria-pressed={displayLanguage === value}
                  aria-label={text.useLanguage(label)}
                  className={`h-8 min-w-10 rounded px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-w-[4.25rem] ${
                    displayLanguage === value
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-white hover:text-gray-800'
                  }`}
                >
                  <span className="sm:hidden">{compactLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:py-5 lg:py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
          {/* 主题目录：手机/平板折叠菜单，大屏左侧竖排 */}
          <aside className="lg:w-60 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-24">
              <p className="mb-3 hidden text-xs font-semibold uppercase tracking-wide text-gray-400 lg:block">
                {text.topicCategory}
              </p>
              {/* 手机/平板：默认收起的主题菜单 */}
              {!showFavorites && (
                <div className="-mx-4 border-b border-gray-100 bg-white px-4 py-2 shadow-sm lg:hidden">
                  <button
                    type="button"
                    onClick={() => setTopicsOpen((open) => !open)}
                    aria-expanded={topicsOpen}
                    aria-controls="mobile-topic-navigation"
                    aria-label={topicsOpen ? text.hideTopics : text.showTopics}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span className="font-medium">{text.topicCategory}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-gray-400">
                      {activeTopic ? getTopicLabel(activeTopic, displayLanguage) : text.all}
                    </span>
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`flex-shrink-0 transition-transform ${topicsOpen ? 'rotate-180' : ''}`}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  {topicsOpen && (
                    <nav id="mobile-topic-navigation" className="grid grid-cols-2 gap-1.5 pt-2" aria-label={text.topicCategory}>
                      <button
                        type="button"
                        onClick={handleAllTopicsClick}
                        className={`flex min-h-10 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                          activeTopic === null
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <span>{text.all}</span>
                        <span className={`min-w-6 text-right ${activeTopic === null ? 'text-gray-300' : 'text-gray-400'}`}>
                          {articles.length}
                        </span>
                      </button>
                      {TOPICS.map(({ key }) => ({ t: key, count: topicCounts.get(key) ?? 0 })).map(({ t, count }) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleTopicClick(t)}
                          className={`flex min-h-10 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs leading-snug transition-colors ${
                            activeTopic === t
                              ? 'bg-gray-900 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          <span className="min-w-0">{getTopicLabel(t, displayLanguage)}</span>
                          <span className={`min-w-6 flex-shrink-0 text-right ${activeTopic === t ? 'text-gray-300' : 'text-gray-400'}`}>
                            {count}
                          </span>
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
              )}
              {/* 大屏竖排 */}
              {!showFavorites && (
              <nav className="hidden lg:flex lg:flex-col lg:space-y-0.5">
                <button
                  onClick={handleAllTopicsClick}
                  className={`flex w-full items-center justify-between gap-6 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                    activeTopic === null && !showFavorites
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>{text.all}</span>
                  <span className={`min-w-9 text-right text-xs ${activeTopic === null && !showFavorites ? 'text-gray-300' : 'text-gray-400'}`}>
                    {articles.length}
                  </span>
                </button>
                {TOPICS.map(({ key }) => ({ t: key, count: topicCounts.get(key) ?? 0 })).map(({ t, count }) => {
                  const isActive = activeTopic === t
                  return (
                    <button
                      key={t}
                      onClick={() => handleTopicClick(t)}
                      className={`flex w-full items-center justify-between gap-6 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="min-w-0 leading-snug">{getTopicLabel(t, displayLanguage)}</span>
                      <span className={`min-w-9 flex-shrink-0 text-right text-xs ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>
                        {count > 0 ? count : '—'}
                      </span>
                    </button>
                  )
                })}
              </nav>
              )}
            </div>
          </aside>

          {/* 主内容区 */}
          <div className="w-full min-w-0 flex-1">
            <TabBar
              module={module}
              region={region}
              language={displayLanguage}
              onModuleChange={(m) => { setModule(m); setPage(1) }}
              onRegionChange={(r) => { setRegion(r); setPage(1) }}
            />

            <div
              role="note"
              aria-label={text.translationNoticeTitle}
              className="mt-3 flex items-start gap-2 border-l-2 border-amber-300 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900"
            >
              <svg
                aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="mt-0.5 flex-shrink-0"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
              <p>
                <span className="font-medium">
                  {text.translationNoticeTitle}{displayLanguage === 'zh' ? '：' : ': '}
                </span>
                {text.translationNotice}
              </p>
            </div>

            {!hasSupabaseEnv && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">{text.missingEnvTitle}</p>
                <p className="mt-2">{text.missingEnvBody}</p>
              </div>
            )}

            {!loading && articles.length > 0 && !showFavorites && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder={text.searchPlaceholder}
                  className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                />
                {sources.length > 1 && (
                  <div ref={sourceDropdownRef} className="relative w-full sm:w-72">
                    <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-blue-400">
                      <div
                        tabIndex={0}
                        aria-label={sourceFilter || text.allSources}
                        title={sourceFilter || text.allSources}
                        className="scrollbar-hide min-w-0 flex-1 touch-pan-x overflow-x-auto whitespace-nowrap px-3 text-left text-sm text-gray-700 focus:outline-none"
                      >
                        {sourceFilter || text.allSources}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSourceDropdownOpen((v) => !v)}
                        aria-label={text.selectSource}
                        aria-haspopup="listbox"
                        aria-expanded={sourceDropdownOpen}
                        className="flex h-full w-9 flex-shrink-0 items-center justify-center border-l border-gray-100 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                      >
                        <svg
                          aria-hidden="true"
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`transition-transform ${sourceDropdownOpen ? 'rotate-180' : ''}`}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    {sourceDropdownOpen && (
                      <div className="absolute right-0 z-20 mt-1 w-full max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white shadow-lg">
                        <div className="max-h-64 touch-pan-x touch-pan-y overflow-auto" role="listbox" aria-label={text.allSources}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={sourceFilter === ''}
                            onClick={() => { setSourceFilter(''); setSourceDropdownOpen(false); setPage(1) }}
                            className={`block w-max min-w-full whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === '' ? 'text-blue-600' : 'text-gray-700'}`}
                          >
                            {text.allSources}
                          </button>
                          {sources.map((s) => {
                            const count = sourceCounts.get(s) ?? 0
                            return (
                              <button
                                key={s}
                                type="button"
                                role="option"
                                aria-selected={sourceFilter === s}
                                onClick={() => { setSourceFilter(s); setSourceDropdownOpen(false); setPage(1) }}
                                className={`flex w-max min-w-full items-center gap-6 whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === s ? 'text-blue-600' : 'text-gray-700'}`}
                                title={s}
                              >
                                <span>{s}</span>
                                <span className="ml-auto min-w-7 flex-shrink-0 text-right text-xs text-gray-400">
                                  {count > 0 ? count : text.unavailable}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!loading && !showFavorites && (search || sourceFilter || activeTopic) && (
              <p className="mt-2 text-xs text-gray-400">
                {text.resultCount(filtered.length)}
                {activeTopic && <span> · {getTopicLabel(activeTopic, displayLanguage)}</span>}
                {sourceFilter && <span> · {sourceFilter}</span>}
                {search && <span> · "{search}"</span>}
              </p>
            )}

            <div id="article-results" ref={resultsTopRef} className="mt-4 scroll-mt-20 space-y-3 sm:scroll-mt-24">
              {loading ? (
                <div className="text-center py-16 text-gray-400 text-sm">{text.loading}</div>
              ) : showFavorites && favoritesLoading ? (
                <div className="text-center py-16 text-gray-400 text-sm">{text.loadingFavorites}</div>
              ) : paginated.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {showFavorites
                    ? text.emptyFavorites
                    : sourceFilter
                    ? text.emptySource(sourceFilter)
                    : activeTopic
                    ? text.emptyTopic(getTopicLabel(activeTopic, displayLanguage))
                    : articles.length === 0
                    ? text.emptyContent
                    : text.noResults}
                </div>
              ) : (
                paginated.map((a) => (
                  <ArticleCard
                    key={a.id}
                    article={a}
                    bookmarked={bookmarks.has(a.id)}
                    onToggleBookmark={toggleBookmark}
                    language={displayLanguage}
                  />
                ))
              )}
            </div>

            <Pagination
              page={page}
              total={filtered.length}
              pageSize={PAGE_SIZE}
              language={displayLanguage}
              onChange={(p) => { setPage(p); scrollToResultsStart() }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
