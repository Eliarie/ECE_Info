'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { browserClient } from '@/lib/browserClient'
import { prepareAccountStorage } from '@/lib/accountStorage'

const AccountContext = createContext<{ user: User | null; recovery: boolean; finishRecovery: () => void }>({
  user: null, recovery: false, finishRecovery: () => {},
})
export const useAccount = () => useContext(AccountContext)

export default function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!browserClient)
  const [user, setUser] = useState<User | null>(null)
  const [recovery, setRecovery] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const client = browserClient
    if (!client) return
    let cancelled = false
    let initialized = false
    let currentUserId: string | null = null
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (Auth holds a lock).
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (initialized && (session?.user.id ?? null) !== currentUserId) {
        // A reload stops every old page's in-flight sync and applies the new
        // account's storage before mounting any data hooks, including other tabs.
        window.location.reload()
      }
    })
    void (async () => {
      try {
        const { data, error: authError } = await client.auth.getSession()
        if (authError) throw authError
        await prepareAccountStorage(client, data.session?.user ?? null)
        if (cancelled) return
        currentUserId = data.session?.user.id ?? null
        initialized = true
        setUser(data.session?.user ?? null)
        setReady(true)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  if (!ready) return (
    <div role="status" className="mx-auto max-w-md px-4 py-20 text-center text-sm text-gray-600">
      {error ? <><p>账号暂时无法连接，请重试。原有数据仍保留在此浏览器。</p><button className="mt-4 rounded border px-4 py-2 focus-visible:ring-2" onClick={() => window.location.reload()}>重新连接</button></> : '正在恢复登录状态…'}
    </div>
  )
  return <AccountContext.Provider value={{ user, recovery, finishRecovery: () => setRecovery(false) }}>{children}</AccountContext.Provider>
}
