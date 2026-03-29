'use client'

import { useState } from 'react'
import type { Article } from '@/lib/types'

interface Props {
  article: Article
  bookmarked: boolean
  onToggleBookmark: (id: string) => void
}

export default function ArticleCard({ article, bookmarked, onToggleBookmark }: Props) {
  const [expanded, setExpanded] = useState(false)

  const title = article.title_zh || article.title_original
  const abstract = article.abstract_zh || article.abstract_original
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('zh-CN')
    : null

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start gap-2">
        <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="group flex-1 min-w-0">
          <h3 className="text-base font-medium text-gray-900 group-hover:text-blue-600 leading-snug">
            {title}
          </h3>
          {article.title_zh && (
            <p className="text-sm text-gray-400 mt-0.5 truncate">{article.title_original}</p>
          )}
        </a>
        <button
          onClick={() => onToggleBookmark(article.id)}
          title={bookmarked ? '取消收藏' : '收藏'}
          className={`flex-shrink-0 mt-0.5 p-1 rounded transition-colors ${
            bookmarked
              ? 'text-amber-500 hover:text-amber-600'
              : 'text-gray-300 hover:text-gray-500'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
        <span>{article.source_name}</span>
        {date && <><span>·</span><span>{date}</span></>}
        {article.authors?.length > 0 && (
          <><span>·</span><span>{article.authors.slice(0, 2).join(', ')}{article.authors.length > 2 ? ' 等' : ''}</span></>
        )}
        {(article.cited_by_count ?? 0) > 0 && (
          <><span>·</span><span className="text-amber-500 font-medium">引用 {article.cited_by_count}</span></>
        )}
      </div>

      {abstract && (
        <div className="mt-2">
          <p className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
            {abstract}
          </p>
          {abstract.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-500 mt-1 hover:underline"
            >
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
