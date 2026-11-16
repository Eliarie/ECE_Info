'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { DisplayLanguage } from '@/lib/types'

export const START_PAGES = ['weekly', 'articles', 'favorites', 'research'] as const
export type StartPage = typeof START_PAGES[number]
export const START_PATHS: Record<StartPage, string> = {
  weekly: '/?view=weekly', articles: '/browse/', favorites: '/favorites/', research: '/research/',
}
const START_KEY = 'ece_start_page'
const LANGUAGE_KEY = 'article_display_language'
const PreferencesContext = createContext({
  language: 'zh' as DisplayLanguage, startPage: 'weekly' as StartPage, ready: false,
  save: (_language: DisplayLanguage, _page: StartPage): boolean => false,
})
export const useSitePreferences = () => useContext(PreferencesContext)

export default function SitePreferences({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<DisplayLanguage>('zh')
  const [startPage, setStartPage] = useState<StartPage>('weekly')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const read = () => {
      try {
        const lang = localStorage.getItem(LANGUAGE_KEY)
        const page = localStorage.getItem(START_KEY)
        setLanguage(lang === 'en' ? 'en' : 'zh')
        setStartPage(START_PAGES.includes(page as StartPage) ? page as StartPage : 'weekly')
      } catch { /* Reading remains available when storage is blocked. */ }
      setReady(true)
    }
    read()
    window.addEventListener('storage', read)
    return () => window.removeEventListener('storage', read)
  }, [])
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en' }, [language])
  const save = (lang: DisplayLanguage, page: StartPage) => {
    try {
      localStorage.setItem(LANGUAGE_KEY, lang)
      localStorage.setItem(START_KEY, page)
      setLanguage(lang); setStartPage(page)
      return true
    } catch { return false }
  }
  return <PreferencesContext.Provider value={{ language, startPage, ready, save }}>{children}</PreferencesContext.Provider>
}
