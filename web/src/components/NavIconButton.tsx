'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

// 顶栏的图标按钮：只放图标，鼠标悬停（或键盘聚焦）时在下方显示说明文字
interface Props {
  label: string // 悬停说明，同时作为读屏文字
  icon: ReactNode
  href?: string
  onClick?: () => void
  active?: boolean // 当前所在页面 / 已打开的模式
  pressed?: boolean // 切换类按钮的开关状态
  badge?: number
  tooltipAlign?: 'center' | 'right'
}

export default function NavIconButton({ label, icon, href, onClick, active, pressed, badge, tooltipAlign = 'center' }: Props) {
  const className = `relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
    active
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900'
  }`
  const content = (
    <>
      {icon}
      {badge ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-gray-900 px-1 text-center text-[10px] font-medium leading-[18px] text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </>
  )
  return (
    <div className="group relative">
      {href ? (
        <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} className={className}>
          {content}
        </button>
      )}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full z-50 mt-2 hidden whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity delay-100 group-hover:opacity-100 group-focus-within:opacity-100 sm:block ${
          tooltipAlign === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
        }`}
      >
        {label}
      </span>
    </div>
  )
}

const iconProps = {
  'aria-hidden': true,
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const ResearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
    <path d="M8.5 11h5M11 8.5v5" />
  </svg>
)

export const BrowseIcon = () => (
  <svg {...iconProps}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...iconProps} fill={filled ? 'currentColor' : 'none'}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

export const SyncIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="4" width="13" height="10" rx="1.5" />
    <path d="M6 18h5" />
    <rect x="16" y="8" width="6" height="12" rx="1.5" />
  </svg>
)
