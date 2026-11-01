// 「专题研究」前后端共用的类型和小工具（不含任何服务端密钥）

export type ResearchPaper = {
  key: string // OpenAlex 的 W 号；Crossref 来的用 D + DOI 的短哈希。综述里的 [短语](key) 靠它对回文章
  title: string
  title_zh?: string
  gist_zh?: string // 一句话说明这篇研究了什么
  relevance?: number // 模型筛选：2 直接相关、1 部分相关、0 不太相关；没筛过为 undefined
  authors: string[]
  year: number | null
  venue: string
  doi: string | null
  url: string
  cited_by: number
  abstract: string
  core: boolean // 发表在网站追踪的核心期刊上
  is_review: boolean // 本身是综述 / 元分析
  is_new?: boolean // 重新搜索时，上一次没有的
}

export type ResearchReview = {
  overview: string
  themes: { title: string; body: string }[]
  gaps: string
  created_at: string
  paper_count: number
}

export type ResearchSearchResult = {
  topic: string
  queries: string[]
  from_year: number | null
  to_year: number | null
  source: 'openalex' | 'crossref'
  papers: ResearchPaper[]
  failed_queries?: number // 这次有几条检索式被限流没查到，结果可能不全
}

export type ResearchTopicData = ResearchSearchResult & {
  searched_at: string
  review: ResearchReview | null
}

export const RESEARCH_REF_PATTERN = '[WD][0-9a-z]+'

export const normalizeTopic = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 80)

// 本地和云端只存截短的摘要，控制每个专题的体积
export const STORED_ABSTRACT_LIMIT = 600
