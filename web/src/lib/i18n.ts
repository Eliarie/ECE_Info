import type { DisplayLanguage, Module, Region } from '@/lib/types'

export const TOPICS = [
  { key: '儿童发展', zh: '儿童发展', en: 'Child Development' },
  { key: '教学与学习', zh: '教学与学习', en: 'Teaching & Learning' },
  { key: '教师教育', zh: '教师教育', en: 'Teacher Education' },
  { key: '课程', zh: '课程', en: 'Curriculum' },
  { key: '游戏', zh: '游戏', en: 'Play' },
  { key: '家庭与社区', zh: '家庭与社区', en: 'Family & Community' },
  { key: '特殊教育', zh: '特殊教育', en: 'Special Education' },
  { key: '教育政策', zh: '教育政策', en: 'Policy & Leadership' },
  { key: '数字教育', zh: '数字教育', en: 'Digital Education' },
  { key: '研究方法与理论', zh: '研究方法与理论', en: 'Research Methods & Theory' },
] as const

const moduleLabels: Record<DisplayLanguage, Record<Module, string>> = {
  zh: {
    research_frontier: '期刊论文',
    research_practice: '实践探索',
    policy: '政策',
    forum: '论坛',
  },
  en: {
    research_frontier: 'Journal Articles',
    research_practice: 'Practice Insights',
    policy: 'Policy',
    forum: 'Forum',
  },
}

const regionLabels: Record<DisplayLanguage, Record<Region, string>> = {
  zh: { international: '国际', domestic: '国内' },
  en: { international: 'International', domestic: 'Domestic' },
}

export const getModuleLabel = (module: Module, language: DisplayLanguage) => moduleLabels[language][module]

export const getRegionLabel = (region: Region, language: DisplayLanguage) => regionLabels[language][region]

export const getTopicLabel = (topic: string, language: DisplayLanguage) => {
  const match = TOPICS.find((item) => item.key === topic)
  return match ? match[language] : topic
}

export const UI_TEXT = {
  zh: {
    brand: '学前教育前沿',
    brandCompact: '学前教育前沿',
    subtitle: '每日自动抓取国内外学术期刊、政策文件与研究动态',
    mainNavigation: '主导航',
    favorites: '收藏',
    backToArticles: '返回全部文章',
    viewFavorites: (count: number) => `查看我的收藏，共 ${count} 篇`,
    interfaceLanguage: '页面语言',
    useLanguage: (label: string) => `切换为${label}界面`,
    topicCategory: '主题分类',
    showTopics: '展开主题分类',
    hideTopics: '收起主题分类',
    all: '全部',
    missingEnvTitle: '缺少前端环境变量，暂时无法读取数据。',
    missingEnvBody: '请在 web 目录创建 .env.local，并填写 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY，然后重启 npm run dev。',
    searchPlaceholder: '搜索标题或摘要…',
    allSources: '全部来源',
    unavailable: '暂无',
    resultCount: (count: number) => `共 ${count} 条`,
    loading: '加载中…',
    loadingFavorites: '加载收藏中…',
    emptyFavorites: '还没有收藏，点击文章右上角的书签图标收藏。',
    emptySource: (source: string) => `「${source}」暂无可用文章。`,
    emptyTopic: (topic: string) => `「${topic}」暂无相关文章。`,
    emptyContent: '暂无内容。可先运行抓取任务，或切换国内/国际查看。',
    noResults: '没有匹配的结果。',
    saved: '已收藏，可在「我的收藏」查看',
    unsaved: '已取消收藏',
    addBookmark: '收藏',
    removeBookmark: '取消收藏',
    moreAuthors: ' 等',
    citations: '引用',
    collapse: '收起',
    expand: '展开',
    noAbstract: '摘要未开放，请前往原文查看',
    previousPage: '上一页',
    nextPage: '下一页',
    pageLabel: (page: number) => `第 ${page} 页`,
  },
  en: {
    brand: 'Early Childhood Research Frontiers',
    brandCompact: 'ECE Frontiers',
    subtitle: 'Daily updates from journals, policy sources, and research communities worldwide',
    mainNavigation: 'Main navigation',
    favorites: 'Favorites',
    backToArticles: 'Back to all articles',
    viewFavorites: (count: number) => `View favorites, ${count} saved`,
    interfaceLanguage: 'Interface language',
    useLanguage: (label: string) => `Switch interface to ${label}`,
    topicCategory: 'Topics',
    showTopics: 'Show topics',
    hideTopics: 'Hide topics',
    all: 'All',
    missingEnvTitle: 'The site cannot load data because its environment variables are missing.',
    missingEnvBody: 'Create .env.local in the web directory, add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart npm run dev.',
    searchPlaceholder: 'Search titles or abstracts…',
    allSources: 'All sources',
    unavailable: 'None',
    resultCount: (count: number) => `${count} results`,
    loading: 'Loading…',
    loadingFavorites: 'Loading favorites…',
    emptyFavorites: 'No favorites yet. Use the bookmark icon on an article to save it.',
    emptySource: (source: string) => `No articles are available from “${source}.”`,
    emptyTopic: (topic: string) => `No articles are available for “${topic}.”`,
    emptyContent: 'No content is available. Run the fetch task or switch between Domestic and International.',
    noResults: 'No matching results.',
    saved: 'Saved. View it in Favorites.',
    unsaved: 'Removed from Favorites.',
    addBookmark: 'Save article',
    removeBookmark: 'Remove from Favorites',
    moreAuthors: ' et al.',
    citations: 'Citations',
    collapse: 'Show less',
    expand: 'Show more',
    noAbstract: 'No abstract is available. Open the original article to read more.',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    pageLabel: (page: number) => `Page ${page}`,
  },
} as const
