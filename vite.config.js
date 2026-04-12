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
const EBBINGHAUS_DAYS = [0, 1, 3, 7, 15, 30]

// ─── 监听地址 ───
const HOST = '127.0.0.1'
const PORT = 31777

// ─── 数据目录（相对于项目根目录）───
const DATA_DIR = 'data'

// ─── 词库界面默认显示哪些语言 ───
// true = 默认显示, false = 默认隐藏
const SHOW_SOURCE = true
const SHOW_TARGET_1 = false
const SHOW_TARGET_2 = false

// ─── 词库分页 ───
// 每页可选数量
const PAGE_SIZES = [10, 30, 50, 100]
// 默认每页数量
const DEFAULT_PAGE_SIZE = 30

// ─── 自动播放默认值 ───
const AUTO_PLAY_ADD = false
const AUTO_PLAY_REVIEW = false

// ─── 日志说明 ───
// 存在浏览器 localStorage key "vf_logs"
// 备份页面可导出, 或控制台: localStorage.getItem("vf_logs")

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
      server.middlewares.use('/vocab-forge/api/write', async (req, res) => {
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
      server.middlewares.use('/vocab-forge/api/read', async (req, res) => {
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
      server.middlewares.use('/vocab-forge/api/delete', async (req, res) => {
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
      server.middlewares.use('/vocab-forge/api/list', (req, res) => {
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

      // GET /api/tts?q=text&tl=lang — proxy Google TTS to bypass referrer check
      server.middlewares.use('/vocab-forge/api/tts', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          const url = new URL(req.url, 'http://localhost')
          const q = url.searchParams.get('q')
          const tl = url.searchParams.get('tl') || 'en'
          if (!q) { res.statusCode = 400; res.end(); return }
          const https = await import('https')
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(q)}&tl=${tl}&client=tw-ob`
          https.default.get(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://translate.google.com/' } }, (proxyRes) => {
            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mpeg')
            res.setHeader('Cache-Control', 'public, max-age=86400')
            proxyRes.pipe(res)
          }).on('error', () => { res.statusCode = 502; res.end() })
        } catch (e) { res.statusCode = 500; res.end() }
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
    __SHOW_SOURCE__: JSON.stringify(SHOW_SOURCE),
    __SHOW_TARGET_1__: JSON.stringify(SHOW_TARGET_1),
    __SHOW_TARGET_2__: JSON.stringify(SHOW_TARGET_2),
    __PAGE_SIZES__: JSON.stringify(PAGE_SIZES),
    __DEFAULT_PAGE_SIZE__: JSON.stringify(DEFAULT_PAGE_SIZE),
    __AUTO_PLAY_ADD__: JSON.stringify(AUTO_PLAY_ADD),
    __AUTO_PLAY_REVIEW__: JSON.stringify(AUTO_PLAY_REVIEW),
  },
  base: '/vocab-forge/',
  server: {
    host: HOST,
    port: PORT,
    open: false,
	  allowedHosts: true,
  },
})