'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from './AccountProvider'
import { START_PATHS, useSitePreferences } from './SitePreferences'

// Only a plain site entry follows the preference. Explicit weekly links,
// article anchors, legacy sync links and account recovery keep their destination.
export default function LandingPreference({ children }: { children: React.ReactNode }) {
  const { ready, startPage, language } = useSitePreferences()
  const { recovery } = useAccount()
  const [showWeekly, setShowWeekly] = useState(false)
  const router = useRouter()
  useEffect(() => {
    if (!ready) return
    if (window.location.search || window.location.hash || recovery || startPage === 'weekly') {
      setShowWeekly(true)
    } else {
      router.replace(START_PATHS[startPage])
    }
  }, [ready, startPage, recovery, router])
  return showWeekly ? children : <p role="status" className="py-20 text-center text-sm text-gray-600">{language === 'zh' ? '正在打开首页…' : 'Opening your start page…'}</p>
}
