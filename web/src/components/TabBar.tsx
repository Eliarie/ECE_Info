'use client'

import type { Module, Region } from '@/lib/types'

const MODULES: { key: Module; label: string }[] = [
  { key: 'research_frontier', label: '期刊论文' },
  { key: 'research_practice', label: '实践探索' },
  { key: 'policy', label: '政策' },
]

const REGIONS: { key: Region; label: string }[] = [
  { key: 'international', label: '国际' },
  { key: 'domestic', label: '国内' },
]

interface Props {
  module: Module
  region: Region
  onModuleChange: (m: Module) => void
  onRegionChange: (r: Region) => void
}

export default function TabBar({ module, region, onModuleChange, onRegionChange }: Props) {
  return (
    <div className="border-b border-gray-200">
      <div className="flex gap-1 mb-3">
        {MODULES.map((m) => (
          <button
            key={m.key}
            onClick={() => onModuleChange(m.key)}
            className={`px-4 py-2 text-sm rounded-t font-medium transition-colors ${
              module === m.key
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1 pb-3">
        {REGIONS.map((r) => (
          <button
            key={r.key}
            onClick={() => onRegionChange(r.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              region === r.key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'text-gray-500 border-gray-300 hover:border-gray-500'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}
