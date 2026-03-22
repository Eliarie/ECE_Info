'use client'

interface Props {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}

export default function Pagination({ page, total, pageSize, onChange }: Props) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-6">
      <button
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="px-2 py-1 text-sm text-gray-500 disabled:opacity-30 hover:text-gray-900"
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            className={`w-8 h-8 text-sm rounded-lg transition-colors ${
              page === p
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className="px-2 py-1 text-sm text-gray-500 disabled:opacity-30 hover:text-gray-900"
      >
        ›
      </button>
    </div>
  )
}
