'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { UI_TEXT } from '@/lib/i18n'
import type { DisplayLanguage } from '@/lib/types'

interface Props {
  link: string
  language: DisplayLanguage
  onClose: () => void
}

// 多设备同步：手机扫二维码打开同步链接，就和这台设备共用同一个同步码（每台设备只需一次）。
// 二维码在浏览器本地生成，同步码不经过任何第三方服务。
export default function SyncDeviceDialog({ link, language, onClose }: Props) {
  const text = UI_TEXT[language]
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(link, { width: 440, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch((error) => console.error('sync QR code error:', error))
    return () => { cancelled = true }
  }, [link])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-device-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="sync-device-title" className="text-base font-semibold text-gray-900">{text.syncDialogTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={text.close}
            className="-mr-1 -mt-1 rounded p-1 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-gray-700">{text.syncDialogScan}</p>

        <div className="mt-4 flex justify-center">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt={text.syncQrAlt} width={220} height={220} className="rounded-lg border border-gray-200" />
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
          )}
        </div>

        <p className="mt-4 text-sm leading-relaxed text-gray-700">{text.syncDialogAfter}</p>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{text.syncDialogIosTip}</p>

        <p className="mt-4 text-xs text-gray-500">{text.syncDialogLinkLabel}</p>
        <div className="mt-1.5 flex gap-2">
          <input
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={text.syncDialogLinkLabel}
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-700"
          />
          <button
            type="button"
            onClick={() => { void copyLink() }}
            className="flex-shrink-0 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700"
          >
            {copied ? text.syncLinkCopiedShort : text.syncCopyLink}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">{text.syncDialogPrivate}</p>
      </div>
    </div>
  )
}
