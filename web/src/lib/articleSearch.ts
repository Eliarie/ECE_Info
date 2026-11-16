import type { Article } from './types'

export const SEARCH_FIELDS = ['title_zh', 'title_original', 'abstract_zh', 'abstract_original', 'source_name', 'doi'] as const

// Keep PostgREST's filter syntax out of user input. Split punctuation, normalize
// full-width text, and AND terms so a title fragment or DOI can be pasted safely.
export function searchTerms(value: string): string[] {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}\s-]/gu, ' ').trim().split(/\s+/u).filter(Boolean).slice(0, 8)
}

export function matchesArticle(article: Article, value: string): boolean {
  const haystack = SEARCH_FIELDS.map((field) => article[field] ?? '').join(' ').normalize('NFKC').toLocaleLowerCase()
  return searchTerms(value).every((term) => haystack.includes(term.toLocaleLowerCase()))
}
