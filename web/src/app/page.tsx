'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import TabBar from '@/components/TabBar'
import ArticleCard from '@/components/ArticleCard'
import Pagination from '@/components/Pagination'
import type { Article, Module, Region } from '@/lib/types'
import coreJournals from '@/config/core-journals.json'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const PAGE_SIZE = 8

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

// 所有可能的主题标签（与 topic_classifier.py 保持一致）
const ALL_TOPICS = [
  '数学与STEM',
  '语言与读写',
  '社会情感发展',
  '游戏与学习',
  '教师与教学',
  '家庭与亲子',
  '科技与AI',
  '健康与体育',
  '特殊需要与融合',
  '评估与测量',
  '课程与环境',
  '政策与质量',
  '认知与神经',
  '创造力与艺术',
]

export default function HomePage() {
  const [module, setModule] = useState<Module>('research_frontier')
  const [region, setRegion] = useState<Region>('international')
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('bookmarks')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  useEffect(() => {
    if (!supabase) { setArticles([]); setLoading(false); return }
    setLoading(true)
    setSearch('')
    setSourceFilter('')
    setPage(1)
    setActiveTopic(null)
    setShowFavorites(false)
    supabase
      .from('articles')
      .select('*')
      .eq('module', module)
      .eq('region', region)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          console.error('Supabase query error:', error)
          setArticles([])
          setLoading(false)
          return
        }
        // 客户端排序：核心期刊优先 -> 引用数降序 -> 发布时间降序
        const sorted = (data ?? []).sort((a, b) => {
          const coreSet = CORE_JOURNAL_NAMES_BY_REGION[region]
          const aCore = coreSet.has(a.source_name)
          const bCore = coreSet.has(b.source_name)
          if (aCore !== bCore) return aCore ? -1 : 1

          const ca = (a as any).cited_by_count ?? 0
          const cb = (b as any).cited_by_count ?? 0
          if (cb !== ca) return cb - ca
          const ta = a.published_at ? new Date(a.published_at).getTime() : 0
          const tb = b.published_at ? new Date(b.published_at).getTime() : 0
          return tb - ta
        })
        setArticles(sorted)
        setLoading(false)
      })
  }, [module, region])

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev)
      const wasBookmarked = next.has(id)
      if (wasBookmarked) next.delete(id)
      else next.add(id)
      try { localStorage.setItem('bookmarks', JSON.stringify(Array.from(next))) } catch {}
      return next
    })
    // 收藏时直接跳到收藏视图
    if (!bookmarks.has(id)) {
      setShowFavorites(true)
      setActiveTopic(null)
      setPage(1)
    }
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
    const set = new Set(articles.map((a) => a.source_name).filter(Boolean))
    return Array.from(set).sort()
  }, [articles])

  const baseList = useMemo(() => {
    if (showFavorites) return articles.filter((a) => bookmarks.has(a.id))
    return articles
  }, [showFavorites, articles, bookmarks])

  const filtered = useMemo(() => {
    let list = baseList
    if (activeTopic) list = list.filter((a) => (a.topic_tags ?? []).includes(activeTopic))
    if (sourceFilter) list = list.filter((a) => a.source_name === sourceFilter)
    if (search.trim()) {
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
  }, [baseList, activeTopic, sourceFilter, search])

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleTopicClick = (t: string) => {
    setActiveTopic((prev) => (prev === t ? null : t))
    setPage(1)
    setShowFavorites(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">学前教育前沿</h1>
          <p className="text-sm text-gray-500 mt-1">每日自动抓取国内外学术期刊、政策文件与研究动态</p>
        </header>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          {/* 主题目录：手机/平板横向滚动，大屏左侧竖排 */}
          <aside className="lg:w-36 lg:flex-shrink-0">
            <div className="lg:sticky lg:top-8">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 hidden lg:block">主题分类</p>
              {/* 手机/平板：带阴影的横向滚动条 + 收藏单独一行 */}
              <div className="lg:hidden -mx-4 px-4 bg-white shadow-sm border-b border-gray-100">
                {/* 收藏行 */}
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <button
                    onClick={() => { setShowFavorites((v) => !v); setActiveTopic(null); setPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors ${
                      showFavorites ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill={showFavorites ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    我的收藏{bookmarks.size > 0 ? `（${bookmarks.size}）` : ''}
                  </button>
                  {bookmarks.size === 0 && <span className="text-xs text-gray-400">点击文章右上角书签收藏</span>}
                </div>
                {/* 主题标签行 */}
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
                  {[
                    ...ALL_TOPICS.map((t) => ({ t, count: topicCounts.get(t) ?? 0 })).filter(({ count }) => count > 0).sort((a, b) => b.count - a.count),
                  ].map(({ t, count }) => (
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
              </div>
              {/* 大屏竖排 */}
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
                {[
                  ...ALL_TOPICS.map((t) => ({ t, count: topicCounts.get(t) ?? 0 })).filter(({ count }) => count > 0).sort((a, b) => b.count - a.count),
                  ...ALL_TOPICS.map((t) => ({ t, count: topicCounts.get(t) ?? 0 })).filter(({ count }) => count === 0),
                ].map(({ t, count }) => {
                  const isActive = activeTopic === t
                  return (
                    <button
                      key={t}
                      onClick={() => handleTopicClick(t)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center justify-between ${
                        isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="truncate">{t}</span>
                      <span className={`ml-1 text-xs flex-shrink-0 ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>
                        {count > 0 ? count : '—'}
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="hidden lg:block mt-6 border-t border-gray-200 pt-4">
                <button
                  onClick={() => { setShowFavorites((v) => !v); setActiveTopic(null); setPage(1) }}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
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
              </div>
            </div>
          </aside>

          {/* 主内容区 */}
          <div className="flex-1 min-w-0">
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

            {!loading && articles.length > 0 && (
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder="搜索标题或摘要…"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                />
                {sources.length > 1 && (
                  <select
                    value={sourceFilter}
                    onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                  >
                    <option value="">全部来源</option>
                    {sources.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {!loading && (search || sourceFilter || activeTopic) && (
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
              ) : paginated.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  {showFavorites
                    ? '还没有收藏，点击文章右上角的书签图标收藏。'
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
