import { NextResponse } from 'next/server'
import { normalizeTopic } from '@/lib/research'
import { callDeepSeek, errorResponseReason } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 前端把检索结果分成几批并发调用：每批翻译标题、写一句话要点、判断和主题的相关度
const MAX_BATCH = 20

type ScreenInput = { key: string; title: string; abstract?: string }

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const topic = normalizeTopic((body.topic ?? '').toString())
    const papers = (Array.isArray(body.papers) ? body.papers : []).slice(0, MAX_BATCH) as ScreenInput[]
    if (!topic || !papers.length) {
      return NextResponse.json({ error: '缺少主题或文章' }, { status: 400 })
    }

    const listing = papers
      .map((p, i) => {
        const abstract = String(p.abstract ?? '').slice(0, 500)
        return `${i + 1}. ${String(p.title ?? '').slice(0, 300)}${abstract ? `\n   Abstract: ${abstract}` : ''}`
      })
      .join('\n')

    const prompt = `你是学前教育领域的研究助理，正在帮用户为研究综述筛选文献。用户的研究主题是：「${topic}」。

下面是检索到的 ${papers.length} 篇文章。请逐篇给出：
- r：和主题的相关度。2 = 直接研究这个主题；1 = 部分相关或能作为背景；0 = 基本无关。
- t：标题的中文翻译，准确、简洁。
- g：用一句通俗中文（不超过 40 字）说明这篇研究了什么、发现了什么；没有摘要就根据标题写，不要编造结论。

输出严格为 JSON（不要其他内容），items 按编号顺序、一篇不落：
{"items":[{"n":1,"r":2,"t":"...","g":"..."}]}

文章：
${listing}`

    const parsed = await callDeepSeek(prompt, 4000, 0.2)
    const items = Array.isArray(parsed.items) ? parsed.items : []
    const results = items
      .map((item: any) => {
        const paper = papers[Number(item?.n) - 1]
        if (!paper) return null
        const r = Math.round(Number(item.r))
        return {
          key: paper.key,
          relevance: r >= 0 && r <= 2 ? r : 1,
          title_zh: String(item.t ?? '').trim().slice(0, 200),
          gist_zh: String(item.g ?? '').trim().slice(0, 120),
        }
      })
      .filter(Boolean)
    return NextResponse.json({ items: results })
  } catch (error) {
    console.error('api/research/screen error:', error)
    return NextResponse.json({ error: '筛选失败', reason: errorResponseReason(error) }, { status: 500 })
  }
}
