'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { UI_TEXT } from '@/lib/i18n'
import type { Article, DisplayLanguage, WeeklyDigest } from '@/lib/types'

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

export default function HomePage() {
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>('zh')
  const [digest, setDigest] = useState<WeeklyDigest | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
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

  const summary = displayLanguage === 'zh'
    ? digest?.summary_zh
    : (digest?.summary_en || digest?.summary_zh)

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
            <p className="mt-5 whitespace-pre-line text-[17px] leading-relaxed text-gray-800">
              {summary}
            </p>
            <p className="mt-4 text-xs text-gray-400">{text.digestDisclaimer}</p>

            {articles.length > 0 && (
              <section className="mt-8">
                <h3 className="text-sm font-semibold text-gray-900">
                  {text.digestCount(articles.length)}
                </h3>
                <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {articles.map((a) => {
                    const title = displayLanguage === 'zh'
                      ? a.title_zh || a.title_original
                      : a.title_original || a.title_zh || ''
                    const date = a.published_at
                      ? new Date(a.published_at).toLocaleDateString(displayLanguage === 'zh' ? 'zh-CN' : 'en-US')
                      : null
                    return (
                      <li key={a.id}>
                        <a
                          href={a.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-gray-50 sm:flex-row sm:items-baseline sm:gap-3"
                        >
                          <span className="min-w-0 flex-1 text-sm leading-snug text-gray-800 group-hover:text-blue-600">
                            {title}
                          </span>
                          <span className="flex-shrink-0 text-xs text-gray-400">
                            {a.source_name}
                            {date ? ` · ${date}` : ''}
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
