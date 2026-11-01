import coreJournals from '@/config/core-journals.json'
import type { ResearchPaper } from '@/lib/research'

// reason 只含错误类别（不含密钥或主题原文），返回给前端便于排查线上失败
export class ResearchError extends Error {
  constructor(public reason: string, message: string) {
    super(message)
  }
}

export async function callDeepSeek(prompt: string, maxTokens: number, temperature = 0.3): Promise<any> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new ResearchError('missing_key', '缺少 DEEPSEEK_API_KEY')

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  })
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300)
    throw new ResearchError(`deepseek_${resp.status}`, `DeepSeek 返回 ${resp.status}: ${detail}`)
  }
  const data = await resp.json()
  try {
    return JSON.parse(data?.choices?.[0]?.message?.content ?? '')
  } catch {
    throw new ResearchError('deepseek_bad_json', 'DeepSeek 返回的不是 JSON')
  }
}

export const errorResponseReason = (error: unknown) =>
  error instanceof ResearchError ? error.reason : 'unknown'

const normalizeVenue = (name: string) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
const CORE_VENUES = new Set((coreJournals.global as string[]).map(normalizeVenue))
const isCoreVenue = (venue: string) => Boolean(venue) && CORE_VENUES.has(normalizeVenue(venue))

const REVIEW_TITLE = /\b(review|meta-analy|systematic|scoping|synthesis)/i

const shortHash = (value: string) => {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const cleanText = (value: string) =>
  value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const ABSTRACT_LIMIT = 1500

// ---------- OpenAlex ----------

type OpenAlexWork = {
  id: string
  doi: string | null
  display_name: string | null
  publication_year: number | null
  cited_by_count: number
  type: string
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null
  authorships?: { author?: { display_name?: string } }[]
  abstract_inverted_index?: Record<string, number[]> | null
}

const rebuildAbstract = (index: Record<string, number[]> | null | undefined) => {
  if (!index) return ''
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word
  }
  return words.filter(Boolean).join(' ')
}

const fromOpenAlex = (w: OpenAlexWork): ResearchPaper | null => {
  const title = cleanText(w.display_name ?? '')
  if (!title) return null
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : null
  const venue = w.primary_location?.source?.display_name ?? ''
  return {
    key: w.id.replace(/^https?:\/\/openalex\.org\//i, ''),
    title,
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean),
    year: w.publication_year,
    venue,
    doi,
    url: doi ? `https://doi.org/${doi}` : w.primary_location?.landing_page_url || w.id,
    cited_by: w.cited_by_count ?? 0,
    abstract: cleanText(rebuildAbstract(w.abstract_inverted_index)).slice(0, ABSTRACT_LIMIT),
    core: isCoreVenue(venue),
    is_review: w.type === 'review' || REVIEW_TITLE.test(title),
  }
}

const OPENALEX_FIELDS =
  'id,doi,display_name,publication_year,cited_by_count,type,primary_location,authorships,abstract_inverted_index'

async function searchOpenAlex(query: string, fromYear: number | null, toYear: number | null, perPage: number) {
  const filters = ['type:article|review']
  if (fromYear || toYear) filters.push(`publication_year:${fromYear ?? ''}-${toYear ?? ''}`)
  const params = new URLSearchParams({
    search: query,
    filter: filters.join(','),
    'per-page': String(perPage),
    select: OPENALEX_FIELDS,
  })
  const key = process.env.OPENALEX_API_KEY
  const email = process.env.OPENALEX_EMAIL
  if (key) params.set('api_key', key)
  else if (email) params.set('mailto', email)

  const url = `https://api.openalex.org/works?${params}`
  let resp = await fetch(url, { cache: 'no-store' })
  if (resp.status === 429) {
    // 每秒请求数超限时稍等一下就好；没配密钥、整体限流时这次重试多半也不行，交给 Crossref 兜底
    await new Promise((resolve) => setTimeout(resolve, 1500))
    resp = await fetch(url, { cache: 'no-store' })
  }
  if (!resp.ok) throw new ResearchError(`openalex_${resp.status}`, `OpenAlex 返回 ${resp.status}`)
  const data = await resp.json()
  return ((data.results ?? []) as OpenAlexWork[]).map(fromOpenAlex).filter((p): p is ResearchPaper => Boolean(p))
}

// ---------- Crossref（OpenAlex 限流时的备用，摘要常常缺失） ----------

type CrossrefItem = {
  DOI: string
  title?: string[]
  'container-title'?: string[]
  issued?: { 'date-parts'?: number[][] }
  'is-referenced-by-count'?: number
  abstract?: string
  author?: { given?: string; family?: string; name?: string }[]
  URL?: string
}

const fromCrossref = (item: CrossrefItem): ResearchPaper | null => {
  const title = cleanText(item.title?.[0] ?? '')
  if (!title || !item.DOI) return null
  const venue = cleanText(item['container-title']?.[0] ?? '')
  const doi = item.DOI.toLowerCase()
  return {
    key: `D${shortHash(doi)}`,
    title,
    authors: (item.author ?? [])
      .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    venue,
    doi,
    url: `https://doi.org/${doi}`,
    cited_by: item['is-referenced-by-count'] ?? 0,
    abstract: cleanText((item.abstract ?? '').replace(/^\s*<jats:title>[^<]*<\/jats:title>/i, '')).slice(0, ABSTRACT_LIMIT),
    core: isCoreVenue(venue),
    is_review: REVIEW_TITLE.test(title),
  }
}

// Crossref 不认布尔检索式，去掉 AND/OR/括号/引号后当关键词用
const plainKeywords = (query: string) =>
  query.replace(/\b(AND|OR|NOT)\b/g, ' ').replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim()

async function searchCrossref(query: string, fromYear: number | null, toYear: number | null, rows: number) {
  const filters = ['type:journal-article']
  if (fromYear) filters.push(`from-pub-date:${fromYear}`)
  if (toYear) filters.push(`until-pub-date:${toYear}`)
  const params = new URLSearchParams({
    'query.bibliographic': plainKeywords(query),
    filter: filters.join(','),
    rows: String(rows),
    select: 'DOI,title,container-title,issued,is-referenced-by-count,abstract,author,URL',
  })
  const email = process.env.OPENALEX_EMAIL
  if (email) params.set('mailto', email)
  const resp = await fetch(`https://api.crossref.org/works?${params}`, { cache: 'no-store' })
  if (!resp.ok) throw new ResearchError(`crossref_${resp.status}`, `Crossref 返回 ${resp.status}`)
  const data = await resp.json()
  return ((data.message?.items ?? []) as CrossrefItem[]).map(fromCrossref).filter((p): p is ResearchPaper => Boolean(p))
}

// ---------- 合并排序 ----------

const PER_QUERY = 40
export const MAX_PAPERS = 60

// 每条检索式各取前 40 篇：被几条检索式同时搜到、排名靠前、被引多的排前面
const rankAndMerge = (lists: ResearchPaper[][]) => {
  const scored = new Map<string, { paper: ResearchPaper; score: number }>()
  const seenDoi = new Map<string, string>()
  for (const list of lists) {
    list.forEach((paper, rank) => {
      const dedupeKey = paper.doi ? seenDoi.get(paper.doi.toLowerCase()) ?? paper.key : paper.key
      const gain = 1 + (1 - rank / PER_QUERY)
      const existing = scored.get(dedupeKey)
      if (existing) {
        existing.score += gain
      } else {
        scored.set(dedupeKey, { paper, score: gain + 0.25 * Math.log10(1 + paper.cited_by) })
        if (paper.doi) seenDoi.set(paper.doi.toLowerCase(), dedupeKey)
      }
    })
  }
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAPERS)
    .map((s) => s.paper)
}

export async function searchPapers(queries: string[], fromYear: number | null, toYear: number | null) {
  const openAlex = await Promise.allSettled(queries.map((q) => searchOpenAlex(q, fromYear, toYear, PER_QUERY)))
  // 没配密钥时 OpenAlex 会随机限流，失败的检索式稍后逐条再试一次，免得结果残缺
  if (openAlex.some((r) => r.status === 'rejected')) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    for (let i = 0; i < openAlex.length; i++) {
      if (openAlex[i].status !== 'rejected') continue
      try {
        openAlex[i] = { status: 'fulfilled', value: await searchOpenAlex(queries[i], fromYear, toYear, PER_QUERY) }
      } catch (error) {
        openAlex[i] = { status: 'rejected', reason: error }
      }
    }
  }
  const okLists = openAlex
    .filter((r): r is PromiseFulfilledResult<ResearchPaper[]> => r.status === 'fulfilled')
    .map((r) => r.value)
  const failure = openAlex.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (okLists.some((list) => list.length > 0)) {
    const failed = openAlex.length - okLists.length
    if (failed) console.warn(`OpenAlex: ${failed}/${openAlex.length} queries failed:`, failure?.reason?.message)
    return { source: 'openalex' as const, papers: rankAndMerge(okLists), failed_queries: failed }
  }
  if (failure) console.warn('OpenAlex search failed, falling back to Crossref:', failure.reason?.message)

  const crossref = await Promise.allSettled(queries.map((q) => searchCrossref(q, fromYear, toYear, PER_QUERY)))
  const crossrefLists = crossref
    .filter((r): r is PromiseFulfilledResult<ResearchPaper[]> => r.status === 'fulfilled')
    .map((r) => r.value)
  if (!crossrefLists.length) {
    const reason = failure?.reason instanceof ResearchError ? failure.reason.reason : 'search_failed'
    throw new ResearchError(reason, '文献检索失败')
  }
  return { source: 'crossref' as const, papers: rankAndMerge(crossrefLists), failed_queries: queries.length - crossrefLists.length }
}
