import { NextResponse } from 'next/server'
import { normalizeTopic, RESEARCH_REF_PATTERN, type ResearchReview } from '@/lib/research'
import { callDeepSeek, errorResponseReason } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PAPERS = 40

type ReviewInput = {
  key: string
  title: string
  title_zh?: string
  year?: number | null
  venue?: string
  cited_by?: number
  abstract?: string
  is_review?: boolean
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const topic = normalizeTopic((body.topic ?? '').toString())
    const papers = (Array.isArray(body.papers) ? body.papers : [])
      .slice(0, MAX_PAPERS)
      .filter((p: ReviewInput) => p && new RegExp(`^${RESEARCH_REF_PATTERN}$`, 'i').test(String(p.key))) as ReviewInput[]
    if (!topic || !papers.length) {
      return NextResponse.json({ error: '缺少主题或文章' }, { status: 400 })
    }

    // 文章多时缩短摘要，控制提示词长度
    const abstractLimit = Math.max(150, Math.min(500, Math.floor(16000 / papers.length)))
    const listing = papers
      .map((p, i) => {
        const meta = [p.year, p.venue, p.cited_by ? `被引 ${p.cited_by}` : '', p.is_review ? '综述类' : '']
          .filter(Boolean)
          .join('，')
        const title = p.title_zh ? `${p.title_zh}（${p.title}）` : p.title
        const abstract = String(p.abstract ?? '').slice(0, abstractLimit)
        return `${i + 1}. ${title}${meta ? `［${meta}］` : ''}${abstract ? `\n   摘要：${abstract}` : ''}`
      })
      .join('\n')

    const prompt = `你是学前教育领域的研究者，正在为「${topic}」这个主题写一份简短的研究综述（文献梳理），读者是想入门这个主题的幼教研究者和一线老师。下面是检索并筛选出的 ${papers.length} 篇已发表研究。

要求：
1. overview：2-3 句话，说明这批研究整体在回答什么问题、时间跨度和研究类型大致如何。
2. themes：把研究归纳成 3-5 个研究方向。每个方向一个简短中文标题，正文 120-220 字：这个方向研究了什么、主要发现或共识是什么、有没有分歧。
3. gaps：80-150 字，指出这批文献还没回答好的问题，或方法上的不足，可作为后续研究切入点。
4. 只依据清单里的内容写，不要编造清单里没有的研究或结论；摘要缺失的文章只引用其标题能支持的内容。
5. 提到具体研究时用 [短语](编号) 内联标注，编号对应清单序号，例如 [同伴冲突中的教师介入](3)。每个方向至少引用 2 篇。
6. 中文书面语，清楚易懂，不要套话。

输出严格为 JSON（不要其他内容）：
{"overview":"...","themes":[{"title":"...","body":"..."}],"gaps":"..."}

文献清单：
${listing}`

    const parsed = await callDeepSeek(prompt, 3000, 0.4)
    // 编号只在这份清单里有意义，存下来之前换成文章 key
    const toKeys = (value: unknown) =>
      String(value ?? '')
        .trim()
        .replace(/\[([^\]]+)\]\((\d+)\)/g, (_, label: string, num: string) => {
          const paper = papers[Number(num) - 1]
          return paper ? `[${label}](${paper.key})` : label
        })
    const themes = (Array.isArray(parsed.themes) ? parsed.themes : [])
      .map((t: any) => ({ title: String(t?.title ?? '').trim(), body: toKeys(t?.body) }))
      .filter((t: { title: string; body: string }) => t.title && t.body)
    if (!themes.length) {
      return NextResponse.json({ error: '生成失败', reason: 'empty_review' }, { status: 500 })
    }
    const review: ResearchReview = {
      overview: toKeys(parsed.overview),
      themes,
      gaps: toKeys(parsed.gaps),
      created_at: new Date().toISOString(),
      paper_count: papers.length,
    }
    return NextResponse.json(review)
  } catch (error) {
    console.error('api/research/review error:', error)
    return NextResponse.json({ error: '生成失败', reason: errorResponseReason(error) }, { status: 500 })
  }
}
