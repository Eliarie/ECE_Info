import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// All pages and account controls share one session and refresh timer.
export const browserClient = url && key ? createClient(url, key) : null
