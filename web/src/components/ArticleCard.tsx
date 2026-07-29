'use client'

import { useState } from 'react'
import { UI_TEXT } from '@/lib/i18n'
import type { Article, DisplayLanguage } from '@/lib/types'

interface Props {
  article: Article
  bookmarked: boolean
  onToggleBookmark: (id: string) => void
  language: DisplayLanguage
}

export default function ArticleCard({ article, bookmarked, onToggleBookmark, language }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const text = UI_TEXT[language]

  const title = language === 'zh'
    ? article.title_zh || article.title_original
    : article.title_original || article.title_zh || ''
  const abstract = language === 'zh'
    ? article.abstract_zh || article.abstract_original
    : article.abstract_original || article.abstract_zh
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US')
    : null

  const handleBookmark = () => {
    onToggleBookmark(article.id)
    const msg = bookmarked ? text.unsaved : text.saved
    setToast(msg)
    setTimeout(() => setToast(null), 200)
  }

  return (
    <div className="relative border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      {toast && (
        <div className="absolute top-2 right-2 bg-gray-800 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg z-10 animate-fade-in">
          {toast}
        </div>
      )}
      <div className="flex items-start gap-2">
        <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="group flex-1 min-w-0">
          <h3 className="text-base font-medium text-gray-900 group-hover:text-blue-600 leading-snug">
            {title}
          </h3>
        </a>
        <button
          onClick={handleBookmark}
          aria-label={bookmarked ? text.removeBookmark : text.addBookmark}
          title={bookmarked ? text.removeBookmark : text.addBookmark}
          className={`flex-shrink-0 mt-0.5 p-1 rounded transition-colors ${
            bookmarked
              ? 'text-amber-500 hover:text-amber-600'
              : 'text-gray-300 hover:text-gray-500'
          }`}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
        <span>{article.source_name}</span>
        {date && <><span>·</span><span>{date}</span></>}
        {article.authors?.length > 0 && (
          <><span>·</span><span>{article.authors.slice(0, 2).join(', ')}{article.authors.length > 2 ? text.moreAuthors : ''}</span></>
        )}
        {(article.cited_by_count ?? 0) > 0 && (
          <><span>·</span><span className="text-amber-500 font-medium">{text.citations} {article.cited_by_count}</span></>
        )}
      </div>

      {abstract ? (
        <div className="mt-2">
          <p className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
            {abstract}
          </p>
          {abstract.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-500 mt-1 hover:underline"
            >
              {expanded ? text.collapse : text.expand}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-400 italic">{text.noAbstract}</p>
      )}
    </div>
  )
}
