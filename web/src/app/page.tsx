'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { UI_TEXT } from '@/lib/i18n'
import { useBookmarks } from '@/lib/useBookmarks'
import type { Article, DigestHighlight, DisplayLanguage, WeeklyDigest } from '@/lib/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const DISPLAY_LANGUAGE_KEY = 'article_display_language'
const INTEREST_KEY = 'digest_interest'
const INTEREST_CACHE_KEY = 'digest_interest_cache'

type InterestResult = {
  interest: string
  week_start: string
  overview_zh: string
  overview_en: string
}

const formatPeriod = (from: string, to: string, language: DisplayLanguage) => {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const fromDate = new Date(`${from}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const toDate = new Date(`${to}T00:00:00`).toLocaleDateString(
    locale,
    language === 'zh' ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  )
  return `${fromDate} — ${toDate}`
}

function renderOverviewLinks(text: string, orderedArticles: (Article | undefined)[]): ReactNode {
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
    if (article?.source_url) {
      parts.push(
        <a
          key={key++}
          href={article.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline decoration-blue-300/70 underline-offset-[3px] transition-colors hover:text-blue-900 hover:decoration-blue-500"
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
  const [digest, setDigest] = useState<WeeklyDigest | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [interest, setInterest] = useState('')
  const [interestResult, setInterestResult] = useState<InterestResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [interestError, setInterestError] = useState(false)
  const [loading, setLoading] = useState(true)
  const refreshedForWeek = useRef<string | null>(null)
  const text = UI_TEXT[displayLanguage]
  const { bookmarks, toggleBookmark } = useBookmarks(supabase)

  useEffect(() => {
    const saved = localStorage.getItem(DISPLAY_LANGUAGE_KEY)
    if (saved === 'zh' || saved === 'en') setDisplayLanguage(saved)
    try {
      const savedInterest = localStorage.getItem(INTEREST_KEY)
      if (savedInterest) setInterest(savedInterest)
      const cached = localStorage.getItem(INTEREST_CACHE_KEY)
      if (cached && savedInterest) {
        const parsed = JSON.parse(cached) as InterestResult
        if (parsed.interest === savedInterest) setInterestResult(parsed)
      }
    } catch {}
  }, [])

  useEffect(() => {
    document.documentElement.lang = displayLanguage === 'zh' ? 'zh-CN' : 'en'
    document.title = text.brand
  }, [displayLanguage, text.brand])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    supabase
      .from('weekly_digests')
      .select('*')
      .order('week_start', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          console.error('weekly_digests query error:', error)
          setLoading(false)
          return
        }
        const latest = (data ?? [])[0] ?? null
        setDigest(latest)
        if (latest && Array.isArray(latest.article_ids) && latest.article_ids.length > 0) {
          supabase
            .from('articles')
            .select('*')
            .in('id', latest.article_ids)
            .then(({ data: articleData, error: articleError }) => {
              if (articleError) {
                console.error('digest articles query error:', articleError)
                setArticles([])
              } else {
                const order = new Map((latest.article_ids as string[]).map((id, i) => [id, i]))
                const sorted = (articleData ?? []).sort(
                  (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
                )
                setArticles(sorted)
              }
              setLoading(false)
            })
        } else {
          setArticles([])
          setLoading(false)
        }
      })
  }, [])

  const changeDisplayLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language)
    try { localStorage.setItem(DISPLAY_LANGUAGE_KEY, language) } catch {}
  }

  const generateInterest = useCallback(async (value: string) => {
    const v = value.trim()
    if (!v) return
    setGenerating(true)
    setInterestError(false)
    try {
      const resp = await fetch('/api/generate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest: v }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) throw new Error(data.error || 'failed')
      const result: InterestResult = {
        interest: v,
        week_start: data.week_start,
        overview_zh: data.overview_zh,
        overview_en: data.overview_en,
      }
      setInterest(v)
      setInterestResult(result)
      try {
        localStorage.setItem(INTEREST_KEY, v)
        localStorage.setItem(INTEREST_CACHE_KEY, JSON.stringify(result))
      } catch {}
    } catch (error) {
      console.error('interest generate error:', error)
      setInterestError(true)
    } finally {
      setGenerating(false)
    }
  }, [])

  const clearInterest = () => {
    setInterest('')
    setInterestResult(null)
    setInterestError(false)
    refreshedForWeek.current = null
    try {
      localStorage.removeItem(INTEREST_KEY)
      localStorage.removeItem(INTEREST_CACHE_KEY)
    } catch {}
  }

  // 有已保存兴趣、但缓存与本周不符时，自动重新生成（每周只触发一次）
  useEffect(() => {
    if (!digest || !interest.trim() || generating) return
    if (refreshedForWeek.current === digest.week_start) return
    const isFresh =
      interestResult &&
      interestResult.interest === interest.trim() &&
      interestResult.week_start === digest.week_start
    if (isFresh) return
    refreshedForWeek.current = digest.week_start
    void generateInterest(interest.trim())
  }, [digest, interest, interestResult, generating, generateInterest])

  const orderedArticles = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.article_ids ?? []).map((id) => byId.get(id))
  }, [articles, digest])

  const highlights: HighlightWithArticle[] = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.highlights ?? []).map((h) => ({ ...h, article: byId.get(h.article_id) }))
  }, [digest, articles])

  const overview = displayLanguage === 'zh'
    ? digest?.summary_zh
    : (digest?.summary_en || digest?.summary_zh)

  const overviewParagraphs = useMemo(
    () => (overview ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean),
    [overview]
  )

  const interestOverview = interestResult
    ? (displayLanguage === 'zh' ? interestResult.overview_zh : (interestResult.overview_en || interestResult.overview_zh))
    : ''

  const interestParagraphs = useMemo(
    () => interestOverview.split(/\n+/).map((p) => p.trim()).filter(Boolean),
    [interestOverview]
  )

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
            <span className="inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
              {text.digestTitle}
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              {formatPeriod(digest.week_start, digest.week_end, displayLanguage)}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {text.digestCount(digest.article_count || orderedArticles.length)}
              <span className="mx-1.5 text-gray-300">·</span>
              {displayLanguage === 'zh' ? 'AI 自动生成' : 'AI-generated'}
            </p>

            {/* 兴趣生成 */}
            <form
              className="mt-6 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void generateInterest(interest)
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
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  placeholder={text.digestInterestPlaceholder}
                  aria-label={text.digestInterestPlaceholder}
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              {interestResult ? (
                <button
                  type="button"
                  onClick={clearInterest}
                  className="flex-shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  {text.digestInterestClear}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={generating || !interest.trim()}
                  className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {text.digestInterestGenerate}
                </button>
              )}
            </form>

            {generating && (
              <p className="mt-3 text-sm text-gray-400">{text.digestGenerating}</p>
            )}
            {interestError && !generating && (
              <p className="mt-3 text-sm text-red-600">{text.digestInterestError}</p>
            )}

            {/* 兴趣概览 */}
            {interestResult && !generating && interestOverview && (
              <section className="mt-10 rounded-xl border border-blue-100 bg-blue-50/50 p-5 sm:p-6">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-blue-600">
                  {text.digestInterestSectionTitle(interestResult.interest)}
                </h3>
                <div className="mt-3 space-y-4">
                  {interestParagraphs.map((paragraph, i) => (
                    <p key={i} className="text-[16px] leading-8 text-gray-800">
                      {renderOverviewLinks(paragraph, orderedArticles)}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {/* 综合概览 */}
            <section className="mt-10">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                {text.digestOverviewTitle}
              </h3>
              <div className="mt-4 space-y-4">
                {overviewParagraphs.map((paragraph, i) => (
                  <p key={i} className="text-[16px] leading-8 text-gray-800">
                    {renderOverviewLinks(paragraph, orderedArticles)}
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
                {text.digestHighlightsTitle}
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
                        className="rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-sm"
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
          </>
        )}
      </main>
    </div>
  )
}
