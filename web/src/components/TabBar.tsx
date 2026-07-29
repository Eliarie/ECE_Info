'use client'

import { getModuleLabel, getRegionLabel } from '@/lib/i18n'
import type { DisplayLanguage, Module, Region } from '@/lib/types'

const MODULES: Module[] = ['research_frontier', 'research_practice', 'policy']

const REGIONS: Region[] = ['international', 'domestic']

interface Props {
  module: Module
  region: Region
  language: DisplayLanguage
  onModuleChange: (m: Module) => void
  onRegionChange: (r: Region) => void
}

export default function TabBar({ module, region, language, onModuleChange, onRegionChange }: Props) {
  return (
    <div className="border-b border-gray-200">
      <div className="mb-2 grid grid-cols-3 gap-0.5 sm:flex">
        {MODULES.map((m) => (
          <button
            key={m}
            onClick={() => onModuleChange(m)}
            className={`min-h-11 rounded-t px-2 py-1.5 text-xs font-medium leading-tight transition-colors sm:min-h-0 sm:px-3 lg:px-4 lg:py-2 lg:text-sm ${
              module === m
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {getModuleLabel(m, language)}
          </button>
        ))}
      </div>
      <div className="flex gap-1 pb-2">
        {REGIONS.map((r) => (
          <button
            key={r}
            onClick={() => onRegionChange(r)}
            className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
              region === r
                ? 'bg-gray-900 text-white border-gray-900'
                : 'text-gray-500 border-gray-300 hover:border-gray-500'
            }`}
          >
            {getRegionLabel(r, language)}
          </button>
        ))}
      </div>
    </div>
  )
}
