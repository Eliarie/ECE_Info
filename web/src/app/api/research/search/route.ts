import { NextResponse } from 'next/server'
import { normalizeTopic, type ResearchSearchResult } from '@/lib/research'
import { callDeepSeek, errorResponseReason, searchPapers } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Plan = { queries: string[]; from_year: number | null; to_year: number | null }

const toYear = (value: unknown) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null
}

// 把中文主题变成 2-3 条英文检索式，顺便读出「近10年」「2015年以来」这类时间范围
async function planQueries(topic: string): Promise<Plan> {
  const thisYear = new Date().getFullYear()
  const prompt = `你是学前教育领域的文献检索专家。用户想就下面这个主题做研究综述，要在 OpenAlex（英文学术数据库）里检索已发表的研究：
「${topic}」

请给出 3 条英文检索式：
1. 检索引擎把空格隔开的词当作「都要出现」（AND），并做词干匹配；所以每条只写 2-4 个关键词或英文双引号短语，例如 "peer conflict" preschool play。不要写 AND、OR、NOT、括号，词多了会漏掉大量文献。
2. 用该领域英文文献里最常用的术语。三条从不同角度覆盖主题：一条最贴近主题原意，一条换用近义术语，一条稍宽一些。
3. 本站面向学前教育（0-8 岁），除非主题明确是别的人群，至少两条要带一个对象词，如 preschool、kindergarten、"early childhood"、"young children"、toddlers。
4. 主题里如果写了时间范围（如「近10年」「2015年以后」），换算成年份，今年是 ${thisYear} 年；没写就都填 null。

输出严格为 JSON（不要其他内容）：
{"queries":["...","..."],"from_year":null,"to_year":null}`

  const parsed = await callDeepSeek(prompt, 400, 0.2)
  const queries = (Array.isArray(parsed.queries) ? parsed.queries : [])
    .map((q: unknown) => String(q ?? '').trim())
    .filter((q: string) => q.length > 0 && q.length <= 300)
    .slice(0, 3)
  return {
    queries: queries.length ? queries : [topic],
    from_year: toYear(parsed.from_year),
    to_year: toYear(parsed.to_year),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const topic = normalizeTopic((body.topic ?? '').toString())
    if (!topic) {
      return NextResponse.json({ error: '缺少研究主题' }, { status: 400 })
    }
    // 「检查新发表」沿用上次的检索式，结果才可比；第一次检索才让模型拟定
    const savedQueries = (Array.isArray(body.queries) ? body.queries : [])
      .map((q: unknown) => String(q ?? '').trim())
      .filter((q: string) => q.length > 0 && q.length <= 300)
      .slice(0, 3)
    const plan: Plan = savedQueries.length
      ? { queries: savedQueries, from_year: toYear(body.from_year), to_year: toYear(body.to_year) }
      : await planQueries(topic)
    const { source, papers, failed_queries } = await searchPapers(plan.queries, plan.from_year, plan.to_year)
    const result: ResearchSearchResult = { topic, ...plan, source, papers, failed_queries }
    return NextResponse.json(result)
  } catch (error) {
    console.error('api/research/search error:', error)
    return NextResponse.json({ error: '检索失败', reason: errorResponseReason(error) }, { status: 500 })
  }
}
