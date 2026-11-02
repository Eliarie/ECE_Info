'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import TabBar from '@/components/TabBar'
import ArticleCard from '@/components/ArticleCard'
import Pagination from '@/components/Pagination'
import NavIconButton, { BookmarkIcon, BrowseIcon, ResearchIcon, SyncIcon } from '@/components/NavIconButton'
import SyncDeviceDialog from '@/components/SyncDeviceDialog'
import { getTopicLabel, TOPICS, UI_TEXT } from '@/lib/i18n'
import { useBookmarks } from '@/lib/useBookmarks'
import type { Article, DisplayLanguage, Module, Region } from '@/lib/types'
import coreJournals from '@/config/core-journals.json'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const PAGE_SIZE = 8
const DISPLAY_LANGUAGE_KEY = 'article_display_language'

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
const SCOPED_LOAD = 1000

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

// PostgREST 的 or=() 语法里逗号、括号等有特殊含义，搜索词里去掉
const sanitizeSearch = (value: string) => value.replace(/[,()*%\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim()

type ArticleMeta = Pick<Article, 'source_name' | 'topic_tags'>

export default function HomePage() {
  const [module, setModule] = useState<Module>('research_frontier')
  const [region, setRegion] = useState<Region>('international')
  const [articles, setArticles] = useState<Article[]>([])
  // 整个栏目每篇的来源和主题（很小），用来算准确的数量；null = 还没取到，先按已载入的算
  const [articleMeta, setArticleMeta] = useState<ArticleMeta[] | null>(null)
  const [scoped, setScoped] = useState<{ key: string; list: Article[] } | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
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
  const [syncLink, setSyncLink] = useState<string | null>(null)
  const text = UI_TEXT[displayLanguage]
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null)
  const resultsTopRef = useRef<HTMLDivElement | null>(null)
  const { bookmarks, toggleBookmark, getSyncLink } = useBookmarks(supabase)

  useEffect(() => {
    const savedLanguage = localStorage.getItem(DISPLAY_LANGUAGE_KEY)
    if (savedLanguage === 'zh' || savedLanguage === 'en') {
      setDisplayLanguage(savedLanguage)
    }
    // 从速览页的「收藏」入口进来时直接打开收藏视图
    if (new URLSearchParams(window.location.search).get('favorites') === '1') {
      setShowFavorites(true)
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
      .limit(INITIAL_LOAD)

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
      const sorted = sortArticles((data ?? []) as Article[], module, region)
      setArticles(sorted)
      setLoading(false)
    })
  }, [module, region])

  useEffect(() => {
    setArticleMeta(null)
    setScoped(null)
    if (!supabase) return
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
  }, [module, region])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [search])

  // 栏目没有全部载入时，按来源/主题/搜索筛选直接查库，否则早一点的文章会被漏掉
  const partiallyLoaded = articles.length >= INITIAL_LOAD && (articleMeta === null || articleMeta.length > articles.length)
  const scopeKey = partiallyLoaded && !showFavorites && (sourceFilter || activeTopic || sanitizeSearch(debouncedSearch))
    ? JSON.stringify([module, region, sourceFilter, activeTopic, sanitizeSearch(debouncedSearch)])
    : null

  useEffect(() => {
    if (!supabase || !scopeKey) return
    if (scoped?.key === scopeKey) return
    const client = supabase
    let cancelled = false
    void (async () => {
      let query = client.from('articles').select('*').eq('module', module).eq('region', region)
      if (sourceFilter === CENTRAL_SCOPE || sourceFilter.startsWith(PROVINCE_SCOPE_PREFIX)) {
        const province = sourceFilter.slice(PROVINCE_SCOPE_PREFIX.length)
        const names = Array.from(new Set((articleMeta ?? articles).map((a) => a.source_name))).filter((name) =>
          sourceFilter === CENTRAL_SCOPE ? isCentralSource(name) : getSourceProvince(name) === province
        )
        query = query.in('source_name', names.length ? names : [''])
      } else if (sourceFilter) {
        query = query.eq('source_name', sourceFilter)
      }
      // topic_tags 是 jsonb，包含查询要传 JSON 文本
      if (activeTopic) query = query.contains('topic_tags', JSON.stringify([activeTopic]))
      const q = sanitizeSearch(debouncedSearch)
      if (q) {
        query = query.or(
          ['title_zh', 'title_original', 'abstract_zh', 'abstract_original'].map((f) => `${f}.ilike.*${q}*`).join(',')
        )
      }
      const { data, error } = await query
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(SCOPED_LOAD)
      if (cancelled) return
      if (error) console.error('Supabase scoped query error:', error)
      setScoped({ key: scopeKey, list: sortArticles((data ?? []) as Article[], module, region) })
    })()
    return () => { cancelled = true }
  }, [scopeKey]) // 其余条件都已编进 scopeKey
  const scopedLoading = Boolean(scopeKey && scoped?.key !== scopeKey)

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

  const openBookmarkSync = () => {
    setSyncLink(getSyncLink())
  }

  const changeDisplayLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language)
    try { localStorage.setItem(DISPLAY_LANGUAGE_KEY, language) } catch {}
  }

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
    if (showFavorites) {
      list = list.filter((a) => a.module === module && a.region === region)
    }
    // 收藏模式下直接展示全部收藏，不按分类/来源/搜索筛选
    if (!showFavorites && activeTopic) list = list.filter((a) => (a.topic_tags ?? []).includes(activeTopic))
    if (!showFavorites && sourceFilter) {
      if (sourceFilter === CENTRAL_SCOPE) {
        list = list.filter((a) => isCentralSource(a.source_name))
      } else if (sourceFilter.startsWith(PROVINCE_SCOPE_PREFIX)) {
        const province = sourceFilter.slice(PROVINCE_SCOPE_PREFIX.length)
        list = list.filter((a) => getSourceProvince(a.source_name) === province)
      } else {
        list = list.filter((a) => a.source_name === sourceFilter)
      }
    }
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
        <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-2 sm:min-h-16 lg:px-8">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">
              <Link href="/" title={text.navHomeTip}>
                <span className="sm:hidden">{text.brandCompact}</span>
                <span className="hidden sm:inline">{text.brand}</span>
              </Link>
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-gray-500 lg:block">
              {text.subtitle}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
            <NavIconButton label={text.navResearchTip} href="/research" icon={<ResearchIcon />} />
            <NavIconButton label={text.navBrowseTip} href="/browse" icon={<BrowseIcon />} active={!showFavorites} />
            <NavIconButton
              label={showFavorites ? text.backToArticles : text.navFavoritesTip(bookmarks.size)}
              onClick={() => {
                if (showFavorites) exitFavorites()
                else enterFavorites()
              }}
              pressed={showFavorites}
              active={showFavorites}
              icon={<BookmarkIcon filled={showFavorites || bookmarks.size > 0} />}
              badge={bookmarks.size}
            />
            <NavIconButton label={text.navSyncTip} onClick={openBookmarkSync} icon={<SyncIcon />} />

            <div
              className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5"
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
                  className={`h-8 w-8 rounded text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    displayLanguage === value
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-white hover:text-gray-800'
                  }`}
                >
                  {shortLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {syncLink && (
        <SyncDeviceDialog link={syncLink} language={displayLanguage} onClose={() => setSyncLink(null)} />
      )}

      <div className="mx-auto max-w-6xl px-4 py-4 sm:py-5 lg:px-8 lg:py-6">
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

            {!loading && !scopedLoading && !showFavorites && (search || sourceFilter || activeTopic) && (
              <p className="mt-2 text-xs text-gray-400">
                {text.resultCount(filtered.length)}
                {activeTopic && <span> · {getTopicLabel(activeTopic, displayLanguage)}</span>}
                {sourceFilter && <span> · {sourceFilterLabel}</span>}
                {search && <span> · "{search}"</span>}
              </p>
            )}

            <div id="article-results" ref={resultsTopRef} className="mt-4 scroll-mt-20 space-y-3 sm:scroll-mt-24">
              {loading || scopedLoading ? (
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
