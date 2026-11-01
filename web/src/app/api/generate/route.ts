import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 一个月的条目比一周多，模型要多想一会儿
export const maxDuration = 60

type DigestArticle = {
  id: string
  title_original: string
  title_zh: string | null
  abstract_original: string | null
  abstract_zh: string | null
  source_name: string
  module: string
  region: string
}

// reason 只含错误类别（不含密钥或兴趣原文），返回给前端便于排查线上失败
class GenerateError extends Error {
  constructor(public reason: string, message: string) {
    super(message)
  }
}

// 兴趣速览按月：默认概括最近 4 期周报，用户写了「最近两个月」之类的就按那个范围（最多 12 期）
const DEFAULT_WEEKS = 4
const MAX_WEEKS = 12

const formatDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}月${d}日`
}

async function generateInterestOverview(
  articles: DigestArticle[],
  interest: string,
  period: string,
  weekCount: number
): Promise<{ overview_zh: string; overview_en: string }> {
  // 条目多时缩短摘要，控制提示词长度
  const abstractLimit = Math.max(80, Math.min(260, Math.floor(20000 / articles.length)))
  const listing = articles
    .map((a, i) => {
      const title = a.title_zh || a.title_original
      const abstract = (a.abstract_zh || a.abstract_original || '').slice(0, abstractLimit)
      const source = a.source_name || ''
      let line = `${i + 1}. ${title}`
      if (source) line += `（${source}）`
      if (abstract) line += `\n   摘要：${abstract}`
      return line
    })
    .join('\n')

  const single = weekCount === 1
  // prompt 与 scripts/generate_digest.py 的 generate_interest_overview 保持一致，改一边要同步另一边
  const prompt = `你是学前教育领域的研究助理。以下是${period}（共 ${weekCount} 期周报）收录的内容（论文/实践/政策）。用户感兴趣的主题是：「${interest}」。

请写一段「兴趣概览」：
1. 只聚焦与「${interest}」相关的内容，忽略无关项；如果相关内容很少，如实说明「这段时间与「${interest}」直接相关的内容较少」。
2. 通俗大白话（面向一线幼教工作者、家长和普通读者），${single ? '200-300 字，2-3 段' : '300-450 字，3-4 段，把相关内容归纳成几条主线，不要逐条罗列'}。
3. 提到具体条目时用 [短语](编号) 内联标注，编号对应上面清单的序号。
4. 同时写一份英文版 overview_en（${single ? '100-160' : '150-230'} 词）。

输出严格为 JSON（不要其他内容）：
{"overview_zh":"...","overview_en":"..."}

内容清单：
${listing}`

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new GenerateError('missing_key', '缺少 DEEPSEEK_API_KEY')

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 2400,
      response_format: { type: 'json_object' },
    }),
  })

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300)
    throw new GenerateError(`deepseek_${resp.status}`, `DeepSeek 返回 ${resp.status}: ${detail}`)
  }

  const data = await resp.json()
  const raw = data?.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw)
  // 编号只在这份清单里有意义，存下来之前换成文章 id，前端不必再知道当时的清单
  const toIds = (value: string) =>
    value.trim().replace(/\[([^\]]+)\]\((\d+)\)/g, (_, label: string, num: string) => {
      const article = articles[Number(num) - 1]
      return article ? `[${label}](${article.id})` : label
    })
  return {
    overview_zh: toIds(parsed.overview_zh || ''),
    overview_en: toIds(parsed.overview_en || ''),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interest = (body.interest ?? '').toString().trim()
    if (!interest) {
      return NextResponse.json({ error: '缺少兴趣词' }, { status: 400 })
    }
    const requestedWeeks = Math.round(Number(body.weeks) || DEFAULT_WEEKS)
    const weeks = Math.min(MAX_WEEKS, Math.max(1, requestedWeeks))

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const { data: digestRows, error: digestError } = await supabase
      .from('weekly_digests')
      .select('article_ids, week_start, week_end')
      .order('week_start', { ascending: false })
      .limit(weeks)
    if (digestError || !digestRows?.length) {
      return NextResponse.json({ error: '暂无数据' }, { status: 404 })
    }
    // 新的一期在前，同一篇只保留一次
    const ids = Array.from(new Set(digestRows.flatMap((row) => (row.article_ids ?? []) as string[])))
    if (!ids.length) {
      return NextResponse.json({ error: '本期无内容' }, { status: 404 })
    }

    const byId = new Map<string, DigestArticle>()
    for (let i = 0; i < ids.length; i += 100) {
      const { data: rows, error: articlesError } = await supabase
        .from('articles')
        .select('id,title_original,title_zh,abstract_original,abstract_zh,source_name,module,region')
        .in('id', ids.slice(i, i + 100))
      if (articlesError) {
        return NextResponse.json({ error: '读取文章失败' }, { status: 500 })
      }
      for (const row of rows ?? []) byId.set(row.id, row as DigestArticle)
    }
    const ordered = ids.map((id) => byId.get(id)).filter((a): a is DigestArticle => Boolean(a))
    if (!ordered.length) {
      return NextResponse.json({ error: '本期无内容' }, { status: 404 })
    }

    const latest = digestRows[0]
    const earliest = digestRows[digestRows.length - 1]
    const period = `${formatDay(earliest.week_start)}至${formatDay(latest.week_end)}`
    const overview = await generateInterestOverview(ordered, interest, period, digestRows.length)

    return NextResponse.json({
      // 存档以覆盖范围里最新的那一期为键
      week_start: latest.week_start,
      week_end: latest.week_end,
      period_start: earliest.week_start,
      weeks: digestRows.length,
      interest,
      overview_zh: overview.overview_zh,
      overview_en: overview.overview_en,
    })
  } catch (error) {
    console.error('api/generate error:', error)
    const reason = error instanceof GenerateError ? error.reason : 'unknown'
    return NextResponse.json({ error: '生成失败', reason }, { status: 500 })
  }
}
