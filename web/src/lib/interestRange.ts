// 从兴趣输入里拆出时间范围：「概括最近两个月 AI和学前教育」→ 兴趣「AI和学前教育」，范围 8 期周报。
// 没写范围时 weeks 为 null，由接口按默认（近一个月）生成。

export const INTEREST_MAX_WEEKS = 12

const ZH_DIGITS: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
}
const EN_DIGITS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, few: 3, couple: 2,
}

const ZH_RANGE = /(?:最近|近|过去|这|本)\s*(\d+|[一两二三四五六七八九十半])?\s*个?\s*(天|日|周|星期|礼拜|月|年)(?:以来|来|内|里)?(?:的)?/
const EN_RANGE = /\b(?:over\s+|in\s+|for\s+)?(?:the\s+)?(?:last|past|recent|this)\s+(\d+|a|an|one|two|three|four|five|six|few|couple(?:\s+of)?)?\s*(day|week|month|year)s?\b/i

const toWeeks = (count: number, unit: string) => {
  if (/天|日|day/i.test(unit)) return Math.ceil(count / 7)
  if (/周|星期|礼拜|week/i.test(unit)) return count
  if (/月|month/i.test(unit)) return Math.round(count * 4)
  return INTEREST_MAX_WEEKS // 年、半年：取上限
}

export function parseInterestRange(raw: string): { interest: string; weeks: number | null } {
  const zh = raw.match(ZH_RANGE)
  const en = zh ? null : raw.match(EN_RANGE)
  const match = zh ?? en
  if (!match) return { interest: raw, weeks: null }

  const numText = (match[1] ?? '').toLowerCase().replace(/\s+of$/, '')
  const count = numText ? Number(numText) || ZH_DIGITS[numText] || EN_DIGITS[numText] || 1 : 1
  const weeks = Math.min(INTEREST_MAX_WEEKS, Math.max(1, toWeeks(count, match[2])))

  const interest = (raw.slice(0, match.index) + ' ' + raw.slice((match.index ?? 0) + match[0].length))
    .replace(/^\s*(?:请|帮我|帮忙)?\s*(?:概括|总结|梳理|汇总|看看|整理)(?:一下)?\s*/, '')
    .replace(/^\s*(?:关于|有关)\s*/, '')
    .replace(/^\s*(?:summari[sz]e|recap|overview of|what'?s new in)\s+/i, '')
    .replace(/\s*(?:的(?:内容|进展|动态|研究进展)?)\s*$/, '')
    .replace(/\s+(?:about|on|in|of)\s*$/i, '')
    .replace(/^\s*(?:about|on|in|of)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 只写了时间、没写主题时，当作普通兴趣原样保留
  return interest ? { interest, weeks } : { interest: raw, weeks: null }
}
