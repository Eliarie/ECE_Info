'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

// Familiar symbols plus short visible names; tooltips explain each destination.
interface Props {
  label: string // 悬停说明，同时作为读屏文字
  icon: ReactNode
  caption?: string
  href?: string
  onClick?: () => void
  active?: boolean // 当前所在页面 / 已打开的模式
  pressed?: boolean // 切换类按钮的开关状态
  badge?: number
  tooltipAlign?: 'center' | 'right'
}

export default function NavIconButton({ label, icon, caption, href, onClick, active, pressed, badge, tooltipAlign = 'center' }: Props) {
  const className = `relative flex h-12 w-9 flex-col items-center justify-center gap-1 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
    active
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900'
  }`
  const content = (
    <>
      {icon}
      {caption && <span aria-hidden="true" className="text-[10px] font-medium leading-none">{caption}</span>}
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
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </svg>
)

export const BrowseIcon = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 12h8M8 16h8" />
  </svg>
)

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...iconProps} fill={filled ? 'currentColor' : 'none'}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

export const AccountIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
  </svg>
)
