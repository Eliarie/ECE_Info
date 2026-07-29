import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const root = resolve(process.cwd(), 'out')
const host = '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

const isFile = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const resolveRequestPath = async (pathname) => {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '')
  const basePath = resolve(root, relativePath)

  if (basePath !== root && !basePath.startsWith(`${root}${sep}`)) {
    return null
  }

  const candidates = pathname.endsWith('/')
    ? [resolve(basePath, 'index.html')]
    : [basePath, `${basePath}.html`, resolve(basePath, 'index.html')]

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return resolve(root, '404.html')
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', `http://${host}`).pathname
    const filePath = await resolveRequestPath(pathname)

    if (!filePath) {
      response.writeHead(403).end('Forbidden')
      return
    }

    const found = await isFile(filePath)
    const body = found ? await readFile(filePath) : Buffer.from('Not found')
    const status = found && filePath.endsWith(`${sep}404.html`) ? 404 : found ? 200 : 404
    response.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    const status = error instanceof URIError ? 400 : 500
    response.writeHead(status).end(status === 400 ? 'Bad request' : 'Internal server error')
  }
})

server.listen(port, host, () => {
  console.log(`Static site available at http://${host}:${port}`)
})
