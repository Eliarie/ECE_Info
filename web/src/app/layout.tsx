import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '学前教育前沿',
  description: '国内外学前教育学术期刊、政策文件与研究动态聚合',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  )
}
