'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import TabBar from '@/components/TabBar'
import ArticleCard from '@/components/ArticleCard'
import Pagination from '@/components/Pagination'
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

// 所有可能的主题标签（与 topic_classifier.py 保持一致）
const ALL_TOPICS = [
  '数字教育',
  '儿童发展',
  '教学与学习',
  '教师教育',
  '课程',
  '游戏',
  '家庭与社区',
  '特殊教育',
  '教育政策',
  '研究方法与理论',
]

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
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>('zh')
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null)
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
    if (!supabase) { setArticles([]); setLoading(false); return }
    setLoading(true)
    setSearch('')
    setSourceFilter('')
    setSourceDropdownOpen(false)
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

  const enterFavorites = () => {
    setShowFavorites(true)
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
    setPage(1)
    setShowFavorites(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white" aria-label="页面工具">
        <div className="mx-auto flex h-11 max-w-5xl items-center justify-end px-4">
          {!loading && (
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-gray-400 sm:inline">阅读语言</span>
              <div
                className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5"
                role="group"
                aria-label="文献显示语言"
              >
                {([
                  ['zh', '中文'],
                  ['en', 'English'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeDisplayLanguage(value)}
                    aria-pressed={displayLanguage === value}
                    className={`h-7 min-w-[4.25rem] rounded px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      displayLanguage === value
                        ? 'bg-gray-900 text-white shadow-sm'
                        : 'text-gray-500 hover:bg-white hover:text-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-5 lg:py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">学前教育前沿</h1>
          <p className="text-sm text-gray-500 mt-1">每日自动抓取国内外学术期刊、政策文件与研究动态</p>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          {/* 主题目录：手机/平板横向滚动，大屏左侧竖排 */}
          <aside className="lg:w-44 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-8">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 hidden lg:block">主题分类</p>
              {/* 手机/平板：带阴影的横向滚动条 + 收藏单独一行 */}
              <div className="lg:hidden -mx-4 px-4 bg-white shadow-sm border-b border-gray-100">
                {/* 收藏行 */}
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (showFavorites) exitFavorites()
                        else enterFavorites()
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors ${
                        showFavorites ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill={showFavorites ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                      我的收藏{bookmarks.size > 0 ? `（${bookmarks.size}）` : ''}
                    </button>
                    {showFavorites && (
                      <button
                        type="button"
                        onClick={exitFavorites}
                        className="px-2 py-1 rounded-full text-xs text-gray-600 hover:bg-gray-100"
                      >
                        ← 返回
                      </button>
                    )}
                  </div>
                  {bookmarks.size === 0 && !showFavorites && <span className="text-xs text-gray-400">点击文章右上角书签收藏</span>}
                </div>
                {/* 主题标签行 */}
                {!showFavorites && (
                <nav className="flex flex-row gap-1.5 overflow-x-auto py-2 scrollbar-hide">
                  <button
                    onClick={() => { setActiveTopic(null); setPage(1); setShowFavorites(false) }}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs transition-colors whitespace-nowrap ${
                      activeTopic === null && !showFavorites
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    全部 {articles.length}
                  </button>
                  {ALL_TOPICS.map((t) => ({ t, count: topicCounts.get(t) ?? 0 })).map(({ t, count }) => (
                    <button
                      key={t}
                      onClick={() => handleTopicClick(t)}
                      className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs transition-colors whitespace-nowrap ${
                        activeTopic === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {t} {count}
                    </button>
                  ))}
                </nav>
                )}
              </div>
              {/* 大屏竖排 */}
              {!showFavorites && (
              <nav className="hidden lg:flex lg:flex-col lg:space-y-0.5">
                <button
                  onClick={() => { setActiveTopic(null); setPage(1); setShowFavorites(false) }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center justify-between ${
                    activeTopic === null && !showFavorites
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>全部</span>
                  <span className={`text-xs ${activeTopic === null && !showFavorites ? 'text-gray-300' : 'text-gray-400'}`}>
                    {articles.length}
                  </span>
                </button>
                {ALL_TOPICS.map((t) => ({ t, count: topicCounts.get(t) ?? 0 })).map(({ t, count }) => {
                  const isActive = activeTopic === t
                  return (
                    <button
                      key={t}
                      onClick={() => handleTopicClick(t)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center justify-between ${
                        isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="min-w-0 leading-snug">{t}</span>
                      <span className={`ml-1 text-xs flex-shrink-0 ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>
                        {count > 0 ? count : '—'}
                      </span>
                    </button>
                  )
                })}
              </nav>
              )}

              <div className="hidden lg:block mt-6 border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (showFavorites) exitFavorites()
                      else enterFavorites()
                    }}
                    className={`flex-1 text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                      showFavorites ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={showFavorites ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>收藏</span>
                    {bookmarks.size > 0 && (
                      <span className="ml-auto text-xs text-gray-400">{bookmarks.size}</span>
                    )}
                  </button>
                  {showFavorites && (
                    <button
                      type="button"
                      onClick={exitFavorites}
                      className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                    >
                      ← 返回
                    </button>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* 主内容区 */}
          <div className="w-full min-w-0 flex-1">
            <TabBar
              module={module}
              region={region}
              onModuleChange={(m) => { setModule(m); setPage(1) }}
              onRegionChange={(r) => { setRegion(r); setPage(1) }}
            />

            {!hasSupabaseEnv && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">缺少前端环境变量，暂时无法读取数据。</p>
                <p className="mt-2">
                  请在 web 目录创建 .env.local，并填写 NEXT_PUBLIC_SUPABASE_URL 和
                  NEXT_PUBLIC_SUPABASE_ANON_KEY，然后重启 npm run dev。
                </p>
              </div>
            )}

            {!loading && articles.length > 0 && !showFavorites && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder="搜索标题或摘要…"
                  className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                />
                {sources.length > 1 && (
                  <div ref={sourceDropdownRef} className="relative w-full sm:w-48">
                    <button
                      type="button"
                      onClick={() => setSourceDropdownOpen((v) => !v)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-left truncate focus:outline-none focus:border-blue-400"
                    >
                      {sourceFilter || '全部来源'}
                    </button>
                    {sourceDropdownOpen && (
                      <div className="absolute z-20 mt-1 right-0 w-64 max-w-[82vw] rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => { setSourceFilter(''); setSourceDropdownOpen(false); setPage(1) }}
                          className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${sourceFilter === '' ? 'text-blue-600' : 'text-gray-700'}`}
                        >
                          全部来源
                        </button>
                        {sources.map((s) => {
                          const count = sourceCounts.get(s) ?? 0
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => { setSourceFilter(s); setSourceDropdownOpen(false); setPage(1) }}
                              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${sourceFilter === s ? 'text-blue-600' : 'text-gray-700'}`}
                              title={s}
                            >
                              <span className="min-w-0 flex-1 truncate">{s}</span>
                              <span className="flex-shrink-0 text-xs text-gray-400">
                                {count > 0 ? count : '暂无'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!loading && !showFavorites && (search || sourceFilter || activeTopic) && (
              <p className="mt-2 text-xs text-gray-400">
                共 {filtered.length} 条
                {activeTopic && <span> · {activeTopic}</span>}
                {sourceFilter && <span> · {sourceFilter}</span>}
                {search && <span> · "{search}"</span>}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="text-center py-16 text-gray-400 text-sm">加载中…</div>
              ) : showFavorites && favoritesLoading ? (
                <div className="text-center py-16 text-gray-400 text-sm">加载收藏中…</div>
              ) : paginated.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {showFavorites
                    ? '还没有收藏，点击文章右上角的书签图标收藏。'
                    : sourceFilter
                    ? `「${sourceFilter}」暂无可用文章。`
                    : activeTopic
                    ? `「${activeTopic}」暂无相关文章。`
                    : articles.length === 0
                    ? '暂无内容。可先运行抓取任务，或切换国内/国际查看。'
                    : '没有匹配的结果。'}
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
              onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
