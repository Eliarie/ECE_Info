'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { browserClient as supabase } from '@/lib/browserClient'
import TabBar from '@/components/TabBar'
import ArticleCard from '@/components/ArticleCard'
import Pagination from '@/components/Pagination'
import SiteHeader from '@/components/SiteHeader'
import { useSitePreferences } from '@/components/SitePreferences'
import { getTopicLabel, TOPICS, UI_TEXT } from '@/lib/i18n'
import { useBookmarks } from '@/lib/useBookmarks'
import type { Article, DisplayLanguage, Module, Region } from '@/lib/types'
import coreJournals from '@/config/core-journals.json'
import { matchesArticle, searchTerms, SEARCH_FIELDS } from '@/lib/articleSearch'

const hasSupabaseEnv = Boolean(supabase)

const PAGE_SIZE = 8

// 首页以国内政策库为主；政策列表先显示中央文件，
// 中央与各省组内均按正式发布日期由新到旧排列。
const CENTRAL_SCOPE = 'scope:central'
const PROVINCE_SCOPE_PREFIX = 'scope:province:'
const PROVINCES = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
] as const

const getSourceProvince = (sourceName: string): string | null => {
  const cityProvinceAliases: Record<string, string> = {
    广州: '广东', 深圳: '广东', 杭州: '浙江', 成都: '四川', 苏州: '江苏',
  }
  for (const [city, province] of Object.entries(cityProvinceAliases)) {
    if (sourceName.includes(city)) return province
  }
  return PROVINCES.find((province) => sourceName.includes(province)) ?? null
}

const isCentralSource = (sourceName: string) => getSourceProvince(sourceName) === null

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

// 列表先载入最新的这么多篇；一个栏目超过这个数时，按来源/主题/搜索筛选改为直接查库
const INITIAL_LOAD = 500
const QUERY_BATCH = 1000

// 国内政策：中央文件整体在前，中央与地方各自按正式发布时间由新到旧。
// 其他场景：发布时间降序 -> 核心期刊优先 -> 引用数降序。
const sortArticles = (data: Article[], module: Module, region: Region) =>
  [...data].sort((a, b) => {
    if (module === 'policy' && region === 'domestic') {
      const aCentral = isCentralSource(a.source_name)
      const bCentral = isCentralSource(b.source_name)
      if (aCentral !== bCentral) return aCentral ? -1 : 1
    }

    const ta = a.published_at ? new Date(a.published_at).getTime() : 0
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0
    if (tb !== ta) return tb - ta

    const coreSet = CORE_JOURNAL_NAMES_BY_REGION[region]
    const aCore = coreSet.has(a.source_name)
    const bCore = coreSet.has(b.source_name)
    if (aCore !== bCore) return aCore ? -1 : 1

    return (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0)
  })

type ArticleMeta = Pick<Article, 'source_name' | 'topic_tags'>

export default function ArticleBrowser({ favorites = false }: { favorites?: boolean }) {
  const [module, setModule] = useState<Module>('research_frontier')
  const [region, setRegion] = useState<Region>('international')
  const [articles, setArticles] = useState<Article[]>([])
  // 整个栏目每篇的来源和主题（很小），用来算准确的数量；null = 还没取到，先按已载入的算
  const [articleMeta, setArticleMeta] = useState<ArticleMeta[] | null>(null)
  const [scoped, setScoped] = useState<{ key: string; list: Article[]; error?: boolean } | null>(null)
  const [searchScope, setSearchScope] = useState<'all' | 'current'>('all')
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [configuredSources, setConfiguredSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const showFavorites = favorites
  const [favoriteArticles, setFavoriteArticles] = useState<Article[]>([])
  const [favoritesLoading, setFavoritesLoading] = useState(favorites)
  const [favoritesError, setFavoritesError] = useState(false)
  const [favoritesAttempt, setFavoritesAttempt] = useState(0)
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false)
  const [topicsOpen, setTopicsOpen] = useState(false)
  const { language: displayLanguage } = useSitePreferences()
  const text = UI_TEXT[displayLanguage]
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null)
  const resultsTopRef = useRef<HTMLDivElement | null>(null)
  const { bookmarks, toggleBookmark } = useBookmarks(supabase)

  useEffect(() => {
    if (!favorites && new URLSearchParams(window.location.search).get('favorites') === '1') {
      window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/favorites/`)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = displayLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = text.brand
  }, [displayLanguage, text.brand])

  useEffect(() => {
    if (showFavorites || !supabase) { setArticles([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setLoadError(false)
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
      .limit(INITIAL_LOAD)

    const sourcesRequest = supabase
      .from('sources')
      .select('name')
      .eq('module', module)
      .eq('region', region)
      .eq('is_active', true)
      .order('name')

    Promise.all([articlesRequest, sourcesRequest]).then(([articleResult, sourceResult]) => {
      if (cancelled) return
      const { data, error } = articleResult
      if (error) {
        console.error('Supabase query error:', error)
        setLoadError(true)
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
      const sorted = sortArticles((data ?? []) as Article[], module, region)
      setArticles(sorted)
      setLoading(false)
    }).catch(() => { if (!cancelled) { setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [module, region, loadAttempt, showFavorites])

  useEffect(() => {
    setArticleMeta(null)
    setScoped(null)
    if (showFavorites || !supabase) return
    const client = supabase
    let cancelled = false
    void (async () => {
      const rows: ArticleMeta[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client
          .from('articles')
          .select('source_name,topic_tags')
          .eq('module', module)
          .eq('region', region)
          .order('id')
          .range(from, from + 999)
        if (cancelled) return
        if (error) {
          console.error('Supabase article meta query error:', error)
          return
        }
        rows.push(...((data ?? []) as ArticleMeta[]))
        if (!data || data.length < 1000) break
      }
      setArticleMeta(rows)
    })()
    return () => { cancelled = true }
  }, [module, region, showFavorites])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [search])

  const terms = searchTerms(debouncedSearch)
  const globalSearch = !showFavorites && searchScope === 'all' && searchTerms(search).length > 0
  // Every search queries the full library, including records older than the
  // initial 500 and all modules/regions unless the reader chooses current scope.
  const partiallyLoaded = articles.length >= INITIAL_LOAD && (articleMeta === null || articleMeta.length > articles.length)
  const scopeKey = !showFavorites && (terms.length > 0 || (partiallyLoaded && (sourceFilter || activeTopic)))
    ? JSON.stringify([module, region, sourceFilter, activeTopic, terms, searchScope, searchAttempt]) : null

  useEffect(() => {
    if (!supabase || !scopeKey) return
    const client = supabase
    let cancelled = false
    void (async () => {
      try {
        const all: Article[] = []
        for (let from = 0; ; from += QUERY_BATCH) {
          let query = client.from('articles').select('*')
          const acrossLibrary = terms.length > 0 && searchScope === 'all'
          if (!acrossLibrary) {
            query = query.eq('module', module).eq('region', region)
            if (sourceFilter === CENTRAL_SCOPE || sourceFilter.startsWith(PROVINCE_SCOPE_PREFIX)) {
              const province = sourceFilter.slice(PROVINCE_SCOPE_PREFIX.length)
              const names = Array.from(new Set((articleMeta ?? articles).map((a) => a.source_name))).filter((name) =>
                sourceFilter === CENTRAL_SCOPE ? isCentralSource(name) : getSourceProvince(name) === province
              )
              query = query.in('source_name', names.length ? names : [''])
            } else if (sourceFilter) query = query.eq('source_name', sourceFilter)
            if (activeTopic) query = query.contains('topic_tags', JSON.stringify([activeTopic]))
          }
          for (const term of terms) query = query.or(SEARCH_FIELDS.map((field) => `${field}.ilike.*${term}*`).join(','))
          const { data, error } = await query.order('published_at', { ascending: false, nullsFirst: false })
            .order('id').range(from, from + QUERY_BATCH - 1)
          if (cancelled) return
          if (error) throw error
          all.push(...((data ?? []) as Article[]))
          if (!data || data.length < QUERY_BATCH) break
        }
        if (!cancelled) setScoped({ key: scopeKey, list: terms.length > 0 && searchScope === 'all' ? all : sortArticles(all, module, region) })
      } catch {
        if (!cancelled) setScoped({ key: scopeKey, list: [], error: true })
      }
    })()
    return () => { cancelled = true }
  }, [scopeKey]) // All request parameters are encoded in scopeKey.
  const scopedLoading = Boolean(scopeKey && scoped?.key !== scopeKey) || (!showFavorites && search.trim() !== debouncedSearch)
  const scopedError = Boolean(scopeKey && scoped?.key === scopeKey && scoped.error)

  useEffect(() => {
    if (!showFavorites) return
    setFavoritesError(false)
    if (!supabase || bookmarks.size === 0) {
      setFavoriteArticles([])
      setFavoritesLoading(false)
      return
    }
    const client = supabase
    let cancelled = false
    setFavoritesLoading(true)
    void (async () => {
      try {
        // Bound URL length and avoid the API's default row limit.
        const ids = Array.from(bookmarks)
        const all: Article[] = []
        for (let from = 0; from < ids.length; from += 100) {
          const { data, error } = await client.from('articles').select('*')
            .in('id', ids.slice(from, from + 100))
            .order('published_at', { ascending: false, nullsFirst: false })
          if (cancelled) return
          if (error) throw error
          all.push(...(data ?? []))
        }
        all.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
        if (!cancelled) {
          setFavoriteArticles(all)
          setPage((current) => Math.min(current, Math.max(1, Math.ceil(all.length / PAGE_SIZE))))
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Supabase favorites query error:', error)
          setFavoritesError(true)
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [showFavorites, bookmarks, favoritesAttempt])

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



  // 侧边栏：统计每个主题在当前列表中的文章数
  const countSource: ArticleMeta[] = articleMeta ?? articles
  const totalCount = countSource.length

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of countSource) {
      for (const tag of (a.topic_tags ?? [])) {
        map.set(tag, (map.get(tag) ?? 0) + 1)
      }
    }
    return map
  }, [countSource])

  const sources = useMemo(() => {
    const set = new Set([
      ...configuredSources,
      ...countSource.map((a) => a.source_name).filter(Boolean),
    ])
    const alphabetical = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    if (module !== 'policy' || region !== 'domestic') return alphabetical

    // 国内政策来源依次显示：中央统筹、教育部、其他中央部门、各省。
    const central = alphabetical.filter(isCentralSource)
    const ministry = central.filter((source) => source === '教育部')
    const otherCentral = central.filter((source) => source !== '教育部')
    return [...ministry, ...otherCentral]
  }, [countSource, configuredSources, module, region])

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const article of countSource) {
      counts.set(article.source_name, (counts.get(article.source_name) ?? 0) + 1)
    }
    return counts
  }, [countSource])

  const centralCount = useMemo(
    () => countSource.filter((article) => isCentralSource(article.source_name)).length,
    [countSource]
  )

  const provinceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const article of countSource) {
      const province = getSourceProvince(article.source_name)
      if (province) counts.set(province, (counts.get(province) ?? 0) + 1)
    }
    return counts
  }, [countSource])

  const sourceFilterLabel = useMemo(() => {
    if (!sourceFilter) return text.allSources
    if (sourceFilter === CENTRAL_SCOPE) return displayLanguage === 'zh' ? '中央统筹' : 'Central government'
    if (sourceFilter.startsWith(PROVINCE_SCOPE_PREFIX)) {
      const province = sourceFilter.slice(PROVINCE_SCOPE_PREFIX.length)
      return displayLanguage === 'zh' ? province : `${province} province`
    }
    return sourceFilter
  }, [sourceFilter, displayLanguage, text.allSources])

  const baseList = useMemo(() => {
    if (showFavorites) return favoriteArticles.filter((a) => bookmarks.has(a.id))
    if (scopeKey) return scoped?.key === scopeKey ? scoped.list : []
    return articles
  }, [showFavorites, articles, bookmarks, favoriteArticles, scopeKey, scoped])

  const filtered = useMemo(() => {
    let list = baseList
    // 收藏模式下直接展示全部收藏，不按分类/来源/搜索筛选
    if (!showFavorites && !globalSearch && activeTopic) list = list.filter((a) => (a.topic_tags ?? []).includes(activeTopic))
    if (!showFavorites && !globalSearch && sourceFilter) {
      if (sourceFilter === CENTRAL_SCOPE) {
        list = list.filter((a) => isCentralSource(a.source_name))
      } else if (sourceFilter.startsWith(PROVINCE_SCOPE_PREFIX)) {
        const province = sourceFilter.slice(PROVINCE_SCOPE_PREFIX.length)
        list = list.filter((a) => getSourceProvince(a.source_name) === province)
      } else {
        list = list.filter((a) => a.source_name === sourceFilter)
      }
    }
    if (!showFavorites && searchTerms(search).length) list = list.filter((article) => matchesArticle(article, search))
    return list
  }, [baseList, activeTopic, sourceFilter, search, showFavorites, globalSearch])

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

  const handleTopicClick = (t: string) => {
    setActiveTopic((prev) => (prev === t ? null : t))
    setTopicsOpen(false)
    setPage(1)
    scrollToResultsStart()
  }

  const handleAllTopicsClick = () => {
    setActiveTopic(null)
    setTopicsOpen(false)
    setPage(1)
    scrollToResultsStart()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader active={showFavorites ? "favorites" : "articles"} bookmarkCount={bookmarks.size} />

      <main className="mx-auto max-w-6xl px-4 py-4 sm:py-5 lg:px-8 lg:py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
          {/* 主题目录：手机/平板折叠菜单，大屏左侧竖排 */}
          {!showFavorites && !globalSearch && <aside className="lg:w-60 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-40">
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
                          {totalCount}
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
                    {totalCount}
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
          </aside>}

          {/* 主内容区 */}
          <div className="w-full min-w-0 flex-1">
            <div className="mb-5">
              <p className="mb-1 text-xs font-medium text-slate-600">{displayLanguage === 'zh' ? '资料库' : 'Library'}</p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{showFavorites ? (displayLanguage === 'zh' ? '我的收藏' : 'My favorites') : (displayLanguage === 'zh' ? '全部文章' : 'All articles')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{showFavorites ? (displayLanguage === 'zh' ? '收藏的论文、实践文章和政策文件，都保存在这里。' : 'Your saved papers, practice articles, and policy documents.') : (displayLanguage === 'zh' ? '查找已收录的论文、实践文章和政策文件。' : 'Find papers, practice articles, and policy documents in the library.')}</p>
            </div>
            {!showFavorites && <section role="search" aria-label={displayLanguage === 'zh' ? '搜索已收录文章' : 'Search the library'} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
              <label htmlFor="article-search" className="mb-2 block text-sm font-medium text-slate-800">{displayLanguage === 'zh' ? '搜索文章' : 'Search articles'}</label>
              <div className="relative">
                <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-500" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
                <input id="article-search" type="search" maxLength={300} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={displayLanguage === 'zh' ? '输入关键词、标题、期刊或 DOI' : 'Keywords, title, journal, or DOI'} className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-16 text-sm text-slate-900 placeholder:text-slate-500 focus:border-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                {search && <button type="button" onClick={() => { setSearch(''); setPage(1); document.getElementById('article-search')?.focus() }} className="absolute right-2 top-1.5 rounded px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2">{displayLanguage === 'zh' ? '清空' : 'Clear'}</button>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="mr-1 text-slate-600">{displayLanguage === 'zh' ? '搜索范围' : 'Search in'}</span>
                {(['all', 'current'] as const).map((scope) => <button key={scope} type="button" aria-pressed={searchScope === scope} onClick={() => { setSearchScope(scope); setPage(1) }} className={`min-h-8 rounded-full border px-3 focus-visible:ring-2 ${searchScope === scope ? 'border-sky-800 bg-sky-800 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{scope === 'all' ? (displayLanguage === 'zh' ? '全部收录' : 'Entire library') : (displayLanguage === 'zh' ? '当前分类' : 'Current category')}</button>)}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{displayLanguage === 'zh' ? (searchScope === 'all' ? '同时查找国内外各类资料的中英文标题、摘要、来源和 DOI。' : '按下方栏目、地区、主题和来源缩小搜索范围。') : (searchScope === 'all' ? 'Search titles, abstracts, sources, and DOIs across all categories and regions.' : 'Narrow your search with the category, region, topic, and source filters below.')}</p>
            </section>}
            {!showFavorites && !globalSearch && <TabBar
              module={module}
              region={region}
              language={displayLanguage}
              onModuleChange={(m) => { setModule(m); setPage(1) }}
              onRegionChange={(r) => { setRegion(r); setPage(1) }}
            />}

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

            {!showFavorites && !globalSearch && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {sources.length > 1 && (
                  <div ref={sourceDropdownRef} className="relative w-full sm:w-72">
                    <button
                      type="button"
                      onClick={() => setSourceDropdownOpen((v) => !v)}
                      aria-label={text.selectSource}
                      aria-haspopup="listbox"
                      aria-expanded={sourceDropdownOpen}
                      title={sourceFilterLabel}
                      className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-700 transition-colors hover:border-gray-300 focus:outline-none focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <span className="scrollbar-hide min-w-0 flex-1 touch-pan-x overflow-x-auto whitespace-nowrap px-3 text-left text-sm">
                        {sourceFilterLabel}
                      </span>
                      <span className="flex h-full w-9 flex-shrink-0 items-center justify-center border-l border-gray-100 text-gray-400 transition-colors">
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
                      </span>
                    </button>
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
                          {module === 'policy' && region === 'domestic' && (
                            <>
                              <button
                                type="button"
                                role="option"
                                aria-selected={sourceFilter === CENTRAL_SCOPE}
                                onClick={() => { setSourceFilter(CENTRAL_SCOPE); setSourceDropdownOpen(false); setPage(1) }}
                                className={`flex w-full items-center gap-6 border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === CENTRAL_SCOPE ? 'text-blue-600' : 'text-gray-700'}`}
                              >
                                <span className="font-medium">中央统筹</span>
                                <span className="ml-auto min-w-7 flex-shrink-0 text-right text-xs text-gray-400">{centralCount}</span>
                              </button>
                              <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium tracking-wide text-gray-400">中央部门</div>
                            </>
                          )}
                          {sources.map((s) => {
                            const count = sourceCounts.get(s) ?? 0
                            return (
                              <button
                                key={s}
                                type="button"
                                role="option"
                                aria-selected={sourceFilter === s}
                                onClick={() => { setSourceFilter(s); setSourceDropdownOpen(false); setPage(1) }}
                                className={`flex w-full items-center gap-6 whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === s ? 'text-blue-600' : 'text-gray-700'}`}
                                title={s}
                              >
                                <span>{s}</span>
                                <span className="ml-auto min-w-7 flex-shrink-0 text-right text-xs text-gray-400">
                                  {count > 0 ? count : text.unavailable}
                                </span>
                              </button>
                            )
                          })}
                          {module === 'policy' && region === 'domestic' && (
                            <>
                              <div className="border-y border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium tracking-wide text-gray-400">各省政策</div>
                              {PROVINCES.map((province) => {
                                const count = provinceCounts.get(province) ?? 0
                                const key = `${PROVINCE_SCOPE_PREFIX}${province}`
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    role="option"
                                    aria-selected={sourceFilter === key}
                                    onClick={() => { setSourceFilter(key); setSourceDropdownOpen(false); setPage(1) }}
                                    className={`flex w-full items-center gap-6 whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === key ? 'text-blue-600' : 'text-gray-700'}`}
                                  >
                                    <span>{province}</span>
                                    <span className="ml-auto min-w-7 flex-shrink-0 text-right text-xs text-gray-400">{count}</span>
                                  </button>
                                )
                              })}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!scopedLoading && !scopedError && !showFavorites && (search || sourceFilter || activeTopic) && (
              <p role="status" className="mt-2 text-xs text-slate-600">
                {text.resultCount(filtered.length)}
                {!globalSearch && activeTopic && <span> · {getTopicLabel(activeTopic, displayLanguage)}</span>}
                {!globalSearch && sourceFilter && <span> · {sourceFilterLabel}</span>}
                {search && <span> · "{search}"</span>}
              </p>
            )}

            <div id="article-results" ref={resultsTopRef} className="mt-4 scroll-mt-36 space-y-3 sm:scroll-mt-40">
              {!showFavorites && (scopedLoading || (!scopeKey && loading)) ? (
                <div role="status" className="text-center py-16 text-slate-600 text-sm">{text.loading}</div>
              ) : !showFavorites && (scopedError || (!scopeKey && loadError)) ? (
                <div role="alert" className="py-12 text-center text-sm text-slate-700"><p>{displayLanguage === 'zh' ? '文章暂时未能加载，请检查网络后重试。' : 'Could not load articles. Check your connection and retry.'}</p><button type="button" className="mt-3 rounded border border-slate-300 px-4 py-2 focus-visible:ring-2" onClick={() => scopeKey ? setSearchAttempt((value) => value + 1) : setLoadAttempt((value) => value + 1)}>{displayLanguage === 'zh' ? '重试' : 'Retry'}</button></div>
              ) : showFavorites && favoritesLoading ? (
                <div className="text-center py-16 text-gray-400 text-sm">{text.loadingFavorites}</div>
              ) : showFavorites && favoritesError ? (
                <div role="alert" className="py-16 text-center text-sm text-gray-600">
                  <p>{text.favoritesFailed}</p>
                  <button type="button" onClick={() => setFavoritesAttempt((attempt) => attempt + 1)} className="mt-3 rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 focus-visible:ring-2">{text.retryFavorites}</button>
                </div>
              ) : paginated.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {showFavorites
                    ? text.emptyFavorites
                    : searchTerms(search).length
                    ? (displayLanguage === 'zh' ? '没有找到相关文章，试试更短的关键词或切换到「全部收录」。' : 'No matching articles. Try fewer keywords or search the entire library.')
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
      </main>
    </div>
  )
}
