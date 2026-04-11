import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  所有配置都在这里改
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── 语言配置 ───
const SOURCE_LANG = 'fr'
const TARGET_LANG_1 = 'zh-CN'
const TARGET_LANG_2 = 'en'

// ─── 艾宾浩斯复习周期（天数）───
const EBBINGHAUS_DAYS = [1, 2, 4, 7, 15, 30]

// ─── 监听地址 ───
const HOST = '0.0.0.0'
const PORT = 443

// ─── 数据目录（相对于项目根目录）───
const DATA_DIR = 'data'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  以下不用改
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Vite plugin: file-based storage API
// Frontend calls /api/read, /api/write, /api/delete, /api/list
function fileStoragePlugin(dataDir) {
  const root = path.resolve(process.cwd(), dataDir)

  const ensureDir = (filePath) => {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  return {
    name: 'file-storage',
    configureServer(server) {
      // POST /api/write { path: "2604/0411.json", data: "..." }
      server.middlewares.use('/api/write', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
          try {
            const { path: p, data } = JSON.parse(body)
            const filePath = path.join(root, p)
            // Security: don't allow ..
            if (filePath.indexOf(root) !== 0) { res.statusCode = 403; res.end(); return }
            ensureDir(filePath)
            fs.writeFileSync(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })

      // POST /api/read { path: "2604/0411.json" }
      server.middlewares.use('/api/read', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
          try {
            const { path: p } = JSON.parse(body)
            const filePath = path.join(root, p)
            if (filePath.indexOf(root) !== 0) { res.statusCode = 403; res.end(); return }
            if (!fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ exists: false }))
              return
            }
            const content = fs.readFileSync(filePath, 'utf8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ exists: true, data: content }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })

      // POST /api/delete { path: "2604/0411.json" }
      server.middlewares.use('/api/delete', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
          try {
            const { path: p } = JSON.parse(body)
            const filePath = path.join(root, p)
            if (filePath.indexOf(root) !== 0) { res.statusCode = 403; res.end(); return }
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
            // Clean empty dirs
            const dir = path.dirname(filePath)
            try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir) } catch {}
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })

      // GET /api/list — returns all json files in data dir
      server.middlewares.use('/api/list', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          const files = []
          const walk = (dir, prefix) => {
            if (!fs.existsSync(dir)) return
            for (const f of fs.readdirSync(dir)) {
              const full = path.join(dir, f)
              const rel = prefix ? prefix + '/' + f : f
              if (fs.statSync(full).isDirectory()) walk(full, rel)
              else if (f.endsWith('.json')) files.push(rel)
            }
          }
          walk(root, '')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), fileStoragePlugin(DATA_DIR)],
  define: {
    __SOURCE_LANG__: JSON.stringify(SOURCE_LANG),
    __TARGET_LANG_1__: JSON.stringify(TARGET_LANG_1),
    __TARGET_LANG_2__: JSON.stringify(TARGET_LANG_2),
    __EBBINGHAUS_DAYS__: JSON.stringify(EBBINGHAUS_DAYS),
  },
  server: {
    host: HOST,
    port: PORT,
    open: false,
  },
})
