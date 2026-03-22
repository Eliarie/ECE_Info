export type Module = 'policy' | 'research_frontier' | 'research_practice' | 'forum'
export type Region = 'domestic' | 'international'

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
}
