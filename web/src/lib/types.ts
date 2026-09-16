export type Module = 'policy' | 'research_frontier' | 'research_practice' | 'forum'
export type Region = 'domestic' | 'international'
export type DisplayLanguage = 'zh' | 'en'

export interface Article {
  id: string
  title_original: string
  title_zh: string | null
  abstract_original: string | null
  abstract_zh: string | null
  authors: string[]
  source_name: string
  source_url: string
  doi: string | null
  module: Module
  region: Region
  published_at: string | null
  fetched_at: string
  is_translated: boolean
  cited_by_count?: number
  topic_tags?: string[]
  topic_version?: string | null
}

export interface WeeklyDigest {
  id: string
  week_start: string
  week_end: string
  summary_zh: string
  summary_en: string | null
  article_ids: string[]
  article_count: number
  created_at: string
}
