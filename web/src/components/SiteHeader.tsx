'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '@/lib/i18n'
import { useAccount } from './AccountProvider'
import AccountButton from './AccountButton'
import { START_PATHS, useSitePreferences } from './SitePreferences'

type Section = 'weekly' | 'articles' | 'favorites' | 'research' | 'settings'
export default function SiteHeader({ active, bookmarkCount = 0 }: { active: Section; bookmarkCount?: number }) {
  const { language, startPage } = useSitePreferences()
  const { user } = useAccount()
  const text = UI_TEXT[language]
  const zh = language === 'zh'
  const [open, setOpen] = useState(false)
  const profile = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!profile.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); profile.current?.querySelector('button')?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])
  const links = [
    { id: 'weekly', href: '/?view=weekly', name: zh ? '每周速览' : 'Weekly digest' },
    { id: 'articles', href: '/browse/', name: zh ? '全部文章' : 'All articles' },
    { id: 'favorites', href: '/favorites/', name: zh ? '我的收藏' : 'Favorites' },
    { id: 'research', href: '/research/', name: zh ? '专题研究' : 'Topic research' },
  ]
  return <header className="site-header">
    <div className="site-header-top">
      <Link href={START_PATHS[startPage]} className="site-brand" aria-label={text.brand}>
        <span>{text.brand}</span>
        <span className="site-subtitle">{zh ? '读研究，找资料，积累自己的问题' : 'Read research. Find sources. Follow your questions.'}</span>
      </Link>
      <div className="site-profile" ref={profile}>
        <button type="button" className="profile-trigger" aria-expanded={open} aria-controls="profile-links" onClick={() => setOpen(!open)}>
          <span className="profile-avatar"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span>
          <span>{zh ? (user ? '个人中心' : '登录 / 设置') : (user ? 'My account' : 'Sign in / Settings')}</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {open && <div id="profile-links" className="profile-dropdown">
          <p className="profile-identity">{user?.email ?? (zh ? '尚未登录' : 'Not signed in')}</p>
          <Link href="/settings/#account" onClick={() => setOpen(false)}>{zh ? (user ? '我的账号' : '登录 / 注册') : (user ? 'My account' : 'Sign in / Register')}</Link>
          <Link href="/settings/" onClick={() => setOpen(false)}>{zh ? '偏好设置' : 'Preferences'}</Link>
        </div>}
      </div>
    </div>
    <nav className="site-navigation" aria-label={text.mainNavigation}>
      {links.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? 'page' : undefined}>
        {link.name}
        {link.id === 'favorites' && bookmarkCount > 0 && <span className="navigation-count">{bookmarkCount > 99 ? '99+' : bookmarkCount}</span>}
      </Link>)}
    </nav>
    <AccountButton language={language} recoveryOnly />
  </header>
}
