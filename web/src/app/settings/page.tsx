'use client'

import { useEffect, useState } from 'react'
import SiteHeader from '@/components/SiteHeader'
import AccountButton from '@/components/AccountButton'
import { START_PAGES, useSitePreferences, type StartPage } from '@/components/SitePreferences'
import type { DisplayLanguage } from '@/lib/types'

export default function SettingsPage() {
  const preferences = useSitePreferences()
  const zh = preferences.language === 'zh'
  const [language, setLanguage] = useState<DisplayLanguage>(preferences.language)
  const [startPage, setStartPage] = useState<StartPage>(preferences.startPage)
  const [status, setStatus] = useState<'saved' | 'error' | null>(null)
  useEffect(() => { setLanguage(preferences.language); setStartPage(preferences.startPage) }, [preferences.language, preferences.startPage])
  useEffect(() => { document.title = zh ? '设置 · 学前教育前沿' : 'Settings · ECE Frontier' }, [zh])
  const pageNames = zh ? ['每周速览', '全部文章', '我的收藏', '专题研究'] : ['Weekly digest', 'All articles', 'Favorites', 'Topic research']
  return <div className="min-h-screen bg-gray-50">
    <SiteHeader active="settings" />
    <main className="settings-main">
      <div className="settings-intro"><p>{zh ? '个人中心' : 'Personal space'}</p><h1>{zh ? '账号与设置' : 'Account and settings'}</h1><span>{zh ? '让这里更符合你的阅读习惯。' : 'Make this space fit your reading habits.'}</span></div>
      <section className="settings-panel" aria-labelledby="preferences-title">
        <h2 id="preferences-title">{zh ? '阅读偏好' : 'Reading preferences'}</h2>
        <form onSubmit={(event) => { event.preventDefault(); setStatus(preferences.save(language, startPage) ? 'saved' : 'error') }}>
          <label className="settings-field" htmlFor="start-page"><span>{zh ? '默认打开的页面' : 'Start page'}</span><span className="settings-field-help">{zh ? '下次从网站首页进入时，直接打开这里。' : 'Open this page when you next enter the site.'}</span>
            <select id="start-page" value={startPage} onChange={(event) => { setStartPage(event.target.value as StartPage); setStatus(null) }}>
              {START_PAGES.map((page, index) => <option key={page} value={page}>{pageNames[index]}</option>)}
            </select>
          </label>
          <label className="settings-field" htmlFor="interface-language"><span>{zh ? '界面语言' : 'Interface language'}</span><span className="settings-field-help">{zh ? '专题研究的内容和综述仍以中文呈现。' : 'Topic research and its reviews remain in Chinese.'}</span>
            <select id="interface-language" value={language} onChange={(event) => { setLanguage(event.target.value as DisplayLanguage); setStatus(null) }}><option value="zh">中文</option><option value="en">English</option></select>
          </label>
          <p className="settings-note">{zh ? '阅读偏好保存在当前浏览器；收藏、专题和兴趣速览通过账号跨设备同步。' : 'Reading preferences are saved in this browser. Favorites, topics, and interest digests sync through your account.'}</p>
          <div className="settings-actions"><button type="submit" className="primary-button" disabled={!preferences.ready}>{zh ? '保存设置' : 'Save settings'}</button>
            {status && <p role={status === 'error' ? 'alert' : 'status'} className={status === 'error' ? 'text-red-700' : 'text-green-800'}>{status === 'saved' ? (zh ? '设置已保存' : 'Settings saved') : (zh ? '浏览器未允许保存，请检查隐私设置后重试。' : 'Storage is blocked. Check your browser privacy settings and try again.')}</p>}
          </div>
        </form>
      </section>
      <section id="account" className="settings-panel scroll-mt-40" aria-label={zh ? '我的账号' : 'My account'}><AccountButton language={preferences.language} embedded /></section>
    </main>
  </div>
}
