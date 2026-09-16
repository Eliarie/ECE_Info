'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { UI_TEXT } from '@/lib/i18n'
import type { Article, DigestHighlight, DisplayLanguage, WeeklyDigest } from '@/lib/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)
const supabase = hasSupabaseEnv ? createClient(supabaseUrl as string, supabaseAnonKey as string) : null

const DISPLAY_LANGUAGE_KEY = 'article_display_language'

const formatPeriod = (from: string, to: string, language: DisplayLanguage) => {
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const fromDate = new Date(`${from}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const toDate = new Date(`${to}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fromDate} — ${toDate}`
}

// 兴趣同义词表：把常见兴趣词展开成一组可匹配的关键词
const INTEREST_SYNONYMS: Record<string, string[]> = {
  ai: ['ai', '人工智能', '机器人', '编程', '计算思维', '机器学习', '大模型', '智能', '算法', '数字化', 'artificial intelligence', 'robot', 'coding', 'computational', 'technology', 'digital'],
  教育: ['教育', '教学', '学习', '教师', '课程', '课堂', '学前', '幼儿', '幼儿园', 'education', 'teaching', 'learning', 'teacher', 'curriculum', 'school', 'classroom'],
  游戏: ['游戏', '玩耍', '玩', 'play', 'game', 'pretend'],
  家庭: ['家庭', '家长', '父母', '亲子', '养育', '照护', 'family', 'parent', 'caregiver', 'home'],
  情绪: ['情绪', '情感', '社会情感', '执行功能', '自我调节', 'emotion', 'socioemotional', 'self-regulation', 'executive function'],
  语言: ['语言', '阅读', '识字', '读写', '双语', 'language', 'literacy', 'reading', 'vocabulary', 'bilingual', 'translanguaging'],
  数学: ['数学', 'stem', '科学', 'math', 'science'],
  健康: ['健康', '睡眠', '营养', '身体', 'health', 'sleep', 'nutrition', 'physical'],
  特殊教育: ['特殊教育', '自闭', '孤独症', '残障', '发展迟缓', '融合', 'special education', 'autism', 'disability', 'inclusion', 'inclusive'],
  贫困: ['贫困', '贫穷', '经济', '弱势', 'poverty', 'economic', 'low-income', 'disadvantaged'],
  教师: ['教师', '师资', '教师专业', 'teacher', 'teaching', 'workforce'],
  政策: ['政策', '治理', '监管', 'policy', 'governance', 'regulation'],
}

function expandInterestTokens(input: string): string[][] {
  const tokens = input.split(/[和与及、，,;；\s/]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)
  return tokens.map((token) => {
    const exact = Object.entries(INTEREST_SYNONYMS).find(([k]) => k.toLowerCase() === token)
    if (exact) return exact[1]
    for (const [key, synonyms] of Object.entries(INTEREST_SYNONYMS)) {
      if (token.includes(key.toLowerCase()) || key.toLowerCase().includes(token)) return synonyms
    }
    return [token]
  })
}

function matchesInterest(text: string, groups: string[][]): boolean {
  const lower = text.toLowerCase()
  return groups.every((group) => group.some((word) => lower.includes(word.toLowerCase())))
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
          className="text-blue-600 underline underline-offset-2 decoration-blue-300 hover:text-blue-800 hover:decoration-blue-600"
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
  const [loading, setLoading] = useState(true)
  const text = UI_TEXT[displayLanguage]

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

  const orderedArticles = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.article_ids ?? []).map((id) => byId.get(id))
  }, [articles, digest])

  const highlights: HighlightWithArticle[] = useMemo(() => {
    const byId = new Map(articles.map((a) => [a.id, a]))
    return (digest?.highlights ?? []).map((h) => ({ ...h, article: byId.get(h.article_id) }))
  }, [digest, articles])

  const interestGroups = useMemo(() => expandInterestTokens(interest), [interest])
  const filteredHighlights = useMemo(() => {
    if (!interest.trim()) return highlights
    return highlights.filter((h) => {
      const searchable = [
        h.article?.title_zh, h.article?.title_original,
        h.result_zh, h.core_zh, h.result_en, h.core_en,
        (h.article?.topic_tags ?? []).join(' '),
      ].filter(Boolean).join(' ')
      return matchesInterest(searchable, interestGroups)
    })
  }, [highlights, interest, interestGroups])

  const overview = displayLanguage === 'zh'
    ? digest?.summary_zh
    : (digest?.summary_en || digest?.summary_zh)

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
        className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur"
        aria-label={text.mainNavigation}
      >
        <div className="mx-auto flex min-h-14 max-w-3xl items-center gap-3 px-4 py-2 sm:min-h-16">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">{text.brand}</h1>
            <p className="mt-0.5 hidden truncate text-xs text-gray-500 sm:block">{text.subtitle}</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            <Link
              href="/browse"
              className="flex h-9 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              {text.digestBrowse}
            </Link>

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

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">{text.loading}</div>
        ) : !hasSupabaseEnv ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">{text.missingEnvTitle}</p>
            <p className="mt-2">{text.missingEnvBody}</p>
          </div>
        ) : !digest ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-500">{text.digestEmpty}</p>
            <Link
              href="/browse"
              className="mt-5 inline-flex h-9 items-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {text.digestBrowse} →
            </Link>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              {text.digestTitle}
            </p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight text-gray-900 sm:text-3xl">
              {formatPeriod(digest.week_start, digest.week_end, displayLanguage)}
            </h2>

            <div className="mt-5 flex items-center gap-2">
              <input
                type="text"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                placeholder={text.digestInterestPlaceholder}
                aria-label={text.digestInterestPlaceholder}
                className="w-full min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
              />
              {interest && (
                <button
                  type="button"
                  onClick={() => setInterest('')}
                  className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  {text.digestInterestClear}
                </button>
              )}
            </div>

            <p className="mt-6 whitespace-pre-line text-[17px] leading-relaxed text-gray-800">
              {renderOverviewLinks(overview ?? '', orderedArticles)}
            </p>
            <p className="mt-4 text-xs text-gray-400">{text.digestDisclaimer}</p>

            {highlights.length > 0 ? (
              <section className="mt-8">
                <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-900">
                  {text.digestHighlightsTitle}
                  {interest.trim() && (
                    <span className="font-normal text-gray-400">
                      · {text.digestInterestMatched(filteredHighlights.length)}
                    </span>
                  )}
                </h3>
                {filteredHighlights.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-400">
                    {text.digestNoMatch}
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                    {filteredHighlights.map((h) => {
                      const title = articleTitle(h.article)
                      const date = articleDate(h.article)
                      const result = displayLanguage === 'zh'
                        ? h.result_zh
                        : (h.result_en || h.result_zh)
                      const core = displayLanguage === 'zh'
                        ? h.core_zh
                        : (h.core_en || h.core_zh)
                      return (
                        <li key={h.article_id} className="px-4 py-3.5">
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                            {h.article?.source_url ? (
                              <a
                                href={h.article.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-blue-600 underline underline-offset-2 decoration-blue-300 hover:text-blue-800"
                              >
                                {title}
                              </a>
                            ) : (
                              <span className="text-sm font-medium text-gray-900">{title}</span>
                            )}
                            <span className="flex-shrink-0 text-xs text-gray-400">
                              {h.article?.source_name}
                              {date ? ` · ${date}` : ''}
                            </span>
                          </div>
                          <div className="mt-1.5 space-y-1 text-sm leading-relaxed text-gray-700">
                            {result && (
                              <p>
                                <span className="font-medium text-gray-900">{text.digestResult}：</span>
                                {result}
                              </p>
                            )}
                            {core && (
                              <p>
                                <span className="font-medium text-gray-900">{text.digestCore}：</span>
                                {core}
                              </p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            ) : (
              articles.length > 0 && (
                <section className="mt-8">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {text.digestCount(articles.length)}
                  </h3>
                  <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                    {articles.map((a) => (
                      <li key={a.id}>
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-gray-50 sm:flex-row sm:items-baseline sm:gap-3"
                        >
                          <span className="min-w-0 flex-1 text-sm leading-snug text-gray-800 group-hover:text-blue-600">
                            {articleTitle(a)}
                          </span>
                          <span className="flex-shrink-0 text-xs text-gray-400">
                            {a.source_name}
                            {articleDate(a) ? ` · ${articleDate(a)}` : ''}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            )}
          </>
        )}
      </main>
    </div>
  )
}
