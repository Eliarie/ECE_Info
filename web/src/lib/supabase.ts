import { createClient } from '@supabase/supabase-js'
import type { Article, Module, Region } from './types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function getArticles(module: Module, region: Region, page = 0): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('module', module)
    .eq('region', region)
    .order('published_at', { ascending: false })
    .range(page * 20, page * 20 + 19)

  if (error) throw error
  return data ?? []
}
