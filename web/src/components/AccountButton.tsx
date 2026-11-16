'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { DisplayLanguage } from '@/lib/types'
import { browserClient } from '@/lib/browserClient'
import { useAccount } from './AccountProvider'
import NavIconButton, { AccountIcon } from './NavIconButton'

type Mode = 'login' | 'signup' | 'reset' | 'update'
const COPY = {
  zh: {
    account: '账号与同步', login: '登录', signup: '注册账号', reset: '找回密码', update: '设置新密码',
    intro: '在手机和电脑上登录同一账号，收藏、专题和兴趣速览会自动同步。',
    email: '邮箱', password: '密码', newPassword: '新密码（至少 8 位）', confirm: '再次输入密码',
    close: '关闭', busy: '请稍候…', logout: '退出当前设备', loggedIn: '已登录',
    saved: '此浏览器原有的收藏和专题会自动保留到账号中。',
    local: '未登录时仍可在此浏览器收藏；登录后可跨设备同步。',
    confirmation: '请到邮箱点击确认链接，再用这个邮箱和密码登录。',
    resetSent: '如果该邮箱已注册，你会收到重设密码的邮件。请从邮件链接打开本站。',
    updated: '密码已更新。', unavailable: '账号服务暂时不可用，请稍后重试。',
    mismatch: '两次输入的密码不一致。', invalid: '邮箱或密码不正确，请检查后重试。',
    unconfirmed: '邮箱尚未确认，请先打开注册邮件中的确认链接。',
    rate: '尝试次数过多，请稍后重试。', exists: '这个邮箱可能已注册，请直接登录或找回密码。',
    failed: '操作未完成，请检查网络后重试。', weak: '请使用至少 8 位的密码。',
  },
  en: {
    account: 'Account and sync', login: 'Sign in', signup: 'Create account', reset: 'Reset password', update: 'Set new password',
    intro: 'Sign in to the same account on your phone and computer to sync favorites, topics, and interest digests.',
    email: 'Email', password: 'Password', newPassword: 'New password (at least 8 characters)', confirm: 'Confirm password',
    close: 'Close', busy: 'Please wait…', logout: 'Sign out on this device', loggedIn: 'Signed in',
    saved: 'Favorites and topics already in this browser will be kept in your account.',
    local: 'You can save locally without signing in. Sign in to sync across devices.',
    confirmation: 'Check your inbox and confirm your email, then sign in with your email and password.',
    resetSent: 'If this email is registered, a password reset email will arrive. Open its link to return here.',
    updated: 'Password updated.', unavailable: 'Account service is unavailable. Please try again later.',
    mismatch: 'Passwords do not match.', invalid: 'Incorrect email or password. Please try again.',
    unconfirmed: 'Please confirm your email using the link in the registration email first.',
    rate: 'Too many attempts. Please try again later.', exists: 'This email may already be registered. Sign in or reset your password.',
    failed: 'Could not complete the request. Check your connection and try again.', weak: 'Use a password with at least 8 characters.',
  },
}

export default function AccountButton({ language }: { language: DisplayLanguage }) {
  const text = COPY[language]
  const { user, recovery, finishRecovery } = useAccount()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => { if (recovery) { setMode('update'); setOpen(true) } }, [recovery])
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open) dialog.current?.close()
  }, [open])

  const close = () => {
    if (busy) return
    setOpen(false); setPassword(''); setConfirm(''); setMessage(''); setError('')
  }
  const changeMode = (next: Mode) => {
    setMode(next); setPassword(''); setConfirm(''); setMessage(''); setError('')
  }
  const report = (issue: { code?: string; status?: number; message?: string }) => {
    const code = issue.code
    setError(code === 'invalid_credentials' ? text.invalid
      : code === 'email_not_confirmed' ? text.unconfirmed
      : code === 'user_already_exists' ? text.exists
      : code === 'weak_password' ? text.weak
      : issue.status === 429 ? text.rate
      : text.failed)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const client = browserClient
    if (!client) { setError(text.unavailable); return }
    if ((mode === 'signup' || mode === 'update') && password !== confirm) { setError(text.mismatch); return }
    setBusy(true); setMessage(''); setError('')
    const redirectTo = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`
    try {
      if (mode === 'login') {
        const { error: issue } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (issue) report(issue)
      } else if (mode === 'signup') {
        const { data, error: issue } = await client.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: redirectTo },
        })
        if (issue) report(issue)
        else if (!data.session) { setMessage(text.confirmation); setPassword(''); setConfirm('') }
      } else if (mode === 'reset') {
        const { error: issue } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        if (issue) report(issue)
        else setMessage(text.resetSent)
      } else {
        const { error: issue } = await client.auth.updateUser({ password })
        if (issue) report(issue)
        else { setMessage(text.updated); setPassword(''); setConfirm(''); finishRecovery(); setMode('login') }
      }
    } catch { setError(text.failed) }
    finally { setBusy(false) }
  }
  const logout = async () => {
    if (!browserClient) return
    setBusy(true); setError('')
    try {
      const { error: issue } = await browserClient.auth.signOut({ scope: 'local' })
      if (issue) report(issue)
    } catch { setError(text.failed) }
    finally { setBusy(false) }
  }

  return <>
    <NavIconButton caption={user ? (language === 'zh' ? '账号' : 'Account') : text.login} label={user ? `${text.account} · ${user.email ?? text.loggedIn}` : text.login}
      onClick={() => { setMode(recovery ? 'update' : 'login'); setOpen(true) }} active={Boolean(user)} icon={<AccountIcon />} tooltipAlign="right" />
    <dialog ref={dialog} aria-labelledby="account-title" onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/30">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id="account-title" className="text-base font-semibold">{user && mode !== 'update' ? text.account : text[mode]}</h2>
          <button type="button" disabled={busy} onClick={close} aria-label={text.close}
            className="rounded px-2 text-xl text-gray-500 hover:bg-gray-100 focus-visible:ring-2 disabled:opacity-50">×</button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{text.intro}</p>
        {user && mode !== 'update' ? <>
          <p className="mt-5 text-sm font-medium">{text.loggedIn}</p>
          <p className="mt-1 break-all text-sm text-gray-600">{user.email}</p>
          <button type="button" disabled={busy} onClick={() => { void logout() }} className="mt-5 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 focus-visible:ring-2 disabled:opacity-50">{busy ? text.busy : text.logout}</button>
        </> : <form onSubmit={(event) => { void submit(event) }} className="mt-5 space-y-4">
          {mode !== 'update' && <label className="block text-sm">{text.email}
            <input type="email" name="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>}
          {mode !== 'reset' && <label className="block text-sm">{mode === 'update' ? text.newPassword : text.password}
            <input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>}
          {(mode === 'signup' || mode === 'update') && <label className="block text-sm">{text.confirm}
            <input type="password" name="confirm" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </label>}
          <button type="submit" disabled={busy || !browserClient} className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">{busy ? text.busy : text[mode]}</button>
          {mode !== 'update' && <div className="flex flex-wrap justify-between gap-3 text-sm">
            {(mode === 'login' ? ['signup', 'reset'] as const : ['login'] as const).map((next) => <button key={next} type="button" disabled={busy} onClick={() => changeMode(next)} className="rounded text-blue-600 hover:underline focus-visible:ring-2">{text[next]}</button>)}
          </div>}
          <p className="text-xs leading-relaxed text-gray-500">{mode === 'signup' ? text.saved : text.local}</p>
        </form>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm leading-relaxed text-green-800">{message}</p>}
      </div>
    </dialog>
  </>
}
