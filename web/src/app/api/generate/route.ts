import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

async function generateInterestOverview(
  articles: DigestArticle[],
  interest: string
): Promise<{ overview_zh: string; overview_en: string }> {
  const listing = articles
    .map((a, i) => {
      const title = a.title_zh || a.title_original
      const abstract = (a.abstract_zh || a.abstract_original || '').slice(0, 260)
      const source = a.source_name || ''
      let line = `${i + 1}. ${title}`
      if (source) line += `（${source}）`
      if (abstract) line += `\n   摘要：${abstract}`
      return line
    })
    .join('\n')

  const prompt = `你是学前教育领域的研究助理。以下是本周收录的内容（论文/实践/政策）。用户感兴趣的主题是：「${interest}」。

请写一段「兴趣概览」：
1. 只聚焦与「${interest}」相关的内容，忽略无关项；如果相关内容很少，如实说明「本周与「${interest}」直接相关的内容较少」。
2. 通俗大白话（面向一线幼教工作者、家长和普通读者），200-300 字，2-3 段。
3. 提到具体条目时用 [短语](编号) 内联标注，编号对应上面清单的序号。
4. 同时写一份英文版 overview_en（100-160 词）。

输出严格为 JSON（不要其他内容）：
{"overview_zh":"...","overview_en":"..."}

内容清单：
${listing}`

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY')

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

  if (!resp.ok) throw new Error(`DeepSeek 返回 ${resp.status}`)

  const data = await resp.json()
  const raw = data?.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw)
  return {
    overview_zh: (parsed.overview_zh || '').trim(),
    overview_en: (parsed.overview_en || '').trim(),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interest = (body.interest ?? '').toString().trim()
    if (!interest) {
      return NextResponse.json({ error: '缺少兴趣词' }, { status: 400 })
    }

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
      .limit(1)
    if (digestError || !digestRows?.length) {
      return NextResponse.json({ error: '暂无数据' }, { status: 404 })
    }
    const digest = digestRows[0]
    const ids: string[] = digest.article_ids ?? []
    if (!ids.length) {
      return NextResponse.json({ error: '本期无内容' }, { status: 404 })
    }

    const { data: articles, error: articlesError } = await supabase
      .from('articles')
      .select('id,title_original,title_zh,abstract_original,abstract_zh,source_name,module,region')
      .in('id', ids)
    if (articlesError) {
      return NextResponse.json({ error: '读取文章失败' }, { status: 500 })
    }

    const byId = new Map((articles ?? []).map((a) => [a.id, a]))
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as DigestArticle[]

    const overview = await generateInterestOverview(ordered, interest)

    return NextResponse.json({
      week_start: digest.week_start,
      week_end: digest.week_end,
      interest,
      overview_zh: overview.overview_zh,
      overview_en: overview.overview_en,
    })
  } catch (error) {
    console.error('api/generate error:', error)
    return NextResponse.json({ error: '生成失败' }, { status: 500 })
  }
}
