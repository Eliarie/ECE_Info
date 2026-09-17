/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
// GitHub Pages 备用站需要静态导出；Vercel 主站保留 API 路由（Serverless Function）。
const isStaticExport = Boolean(basePath)

const nextConfig = {
  ...(isStaticExport ? { output: 'export' } : {}),
  basePath,
  assetPrefix: basePath,
  trailingSlash: true,
}
module.exports = nextConfig
