import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fsp from 'fs/promises'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'

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

// ─── 访问路径前缀（反向代理下的子路径）───
const BASE_PATH = '/vocab-forge'

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
//
// 原有接口（保持兼容）:
//   POST /api/read    { path }            → { exists, data }
//   POST /api/write   { path, data }      → { ok, uid?, prevRev?, rev? }
//   POST /api/delete  { path }            → { ok, uid?, prevRev?, rev? }
//   GET  /api/list                        → { files }
//   GET  /api/tts?q=&tl=
//
// 批量接口（新）:
//   GET  /api/snapshot?uid=   一次返回 global + meta + 该用户所有日文件（不带 uid 时取 activeUser）
//   POST /api/sync            { uid, files: [{ path, cards, dropIds }] }
//                             服务端在该用户的写锁内对每个文件做"读-合并-写"：
//                             结果 = 客户端给的 cards + 磁盘上客户端不知道的卡片（dropIds 中的除外）
//   GET  /api/rev?uid=        当前数据版本号，用于判断其他设备是否改过数据
function fileStoragePlugin(dataDir, basePath) {
  const root = path.resolve(process.cwd(), dataDir)
  const gzip = promisify(zlib.gzip)
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status }
  }

  // 严格校验路径必须在数据目录内（原来的 indexOf 判断会放行 data2/ 这类兄弟目录）
  const resolveSafe = p => {
    if (typeof p !== 'string' || !p) throw new HttpError(400, 'path required')
    const full = path.resolve(root, p)
    const rel = path.relative(root, full)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(403, 'forbidden path')
    return full
  }
  const UID_RE = /^[A-Za-z0-9_-]{1,64}$/
  const checkUid = uid => {
    if (!UID_RE.test(uid || '')) throw new HttpError(400, 'bad uid')
    return uid
  }
  const uidOfPath = p => {
    const m = /^users\/([^/]+)\//.exec(String(p).replace(/\\/g, '/'))
    return m && UID_RE.test(m[1]) ? m[1] : null
  }

  // 按 Buffer 拼接后再解码。原来的 body += chunk 在请求体超过一个分片（约 64KB）时，
  // 会把切在分片边界上的中文/重音字符解码成乱码。
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new HttpError(400, 'invalid json')) }
    })
    req.on('error', reject)
  })

  const send = async (req, res, status, obj) => {
    let buf = Buffer.from(JSON.stringify(obj))
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      buf = await gzip(buf)
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Vary', 'Accept-Encoding')
    }
    res.setHeader('Content-Length', buf.length)
    res.end(buf)
  }

  const handle = (method, fn) => async (req, res) => {
    if (req.method !== method) { res.statusCode = 405; res.end(); return }
    try {
      await send(req, res, 200, await fn(req))
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      if (status === 500) console.error('[file-storage]', e)
      try { await send(req, res, status, { error: e.message }) } catch { res.end() }
    }
  }

  const readText = async full => {
    try { return await fsp.readFile(full, 'utf8') }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  const parseMaybe = text => { try { return JSON.parse(text) } catch { return text } }

  // 先写临时文件再 rename，进程中途被杀也不会留下写了一半的 JSON
  const atomicWrite = async (full, text) => {
    await fsp.mkdir(path.dirname(full), { recursive: true })
    const tmp = `${full}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    await fsp.writeFile(tmp, text, 'utf8')
    for (let i = 0; ; i++) {
      try { await fsp.rename(tmp, full); return }
      catch (e) {
        // Windows 上文件被杀毒/索引短暂占用时会 EPERM/EBUSY，稍等重试
        if (i < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await sleep(20 * (i + 1)); continue }
        await fsp.rm(tmp, { force: true }).catch(() => { })
        throw e
      }
    }
  }
  const removeFile = async full => {
    try { await fsp.unlink(full) } catch (e) { if (e.code !== 'ENOENT') throw e }
    try {
      const dir = path.dirname(full)
      if (dir !== root && (await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir)
    } catch { }
  }
  const quarantine = async full => {
    const dst = `${full}.corrupt-${Date.now()}`
    await fsp.rename(full, dst).catch(() => { })
    console.warn('[file-storage] invalid JSON moved to', dst)
  }

  const walk = async (dir, prefix, out = []) => {
    let entries
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) }
    catch (e) { if (e.code === 'ENOENT') return out; throw e }
    await Promise.all(entries.map(async ent => {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(path.join(dir, ent.name), rel, out)
      else if (ent.name.endsWith('.json')) out.push(rel)
    }))
    return out
  }

  // 每个用户一把写锁：同一用户的所有读改写串行执行，多设备同时写也不会互相覆盖
  const locks = new Map()
  const withLock = (key, fn) => {
    const run = (locks.get(key) || Promise.resolve()).catch(() => { }).then(fn)
    locks.set(key, run.catch(() => { }))
    return run
  }
  const lockKeyOf = p => uidOfPath(p) || '__root__'

  // 版本号：服务启动时间 + 计数。重启后前缀变化，客户端会自动重新拉取
  const bootId = Date.now().toString(36)
  const revCounters = new Map()
  const getRev = uid => `${bootId}.${revCounters.get(uid) || 0}`
  const bumpRev = uid => revCounters.set(uid, (revCounters.get(uid) || 0) + 1)

  return {
    name: 'file-storage',
    configureServer(server) {
      const api = `${basePath}/api`
      const use = (route, h) => server.middlewares.use(`${api}/${route}`, h)

      use('read', handle('POST', async req => {
        const { path: p } = await readBody(req)
        const text = await readText(resolveSafe(p))
        return text === null ? { exists: false } : { exists: true, data: text }
      }))

      use('write', handle('POST', async req => {
        const { path: p, data } = await readBody(req)
        const full = resolveSafe(p)
        const uid = uidOfPath(p)
        return withLock(lockKeyOf(p), async () => {
          const prevRev = uid ? getRev(uid) : undefined
          await atomicWrite(full, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
          if (uid) bumpRev(uid)
          return uid ? { ok: true, uid, prevRev, rev: getRev(uid) } : { ok: true }
        })
      }))

      use('delete', handle('POST', async req => {
        const { path: p } = await readBody(req)
        const full = resolveSafe(p)
        const uid = uidOfPath(p)
        return withLock(lockKeyOf(p), async () => {
          const prevRev = uid ? getRev(uid) : undefined
          await removeFile(full)
          if (uid) bumpRev(uid)
          return uid ? { ok: true, uid, prevRev, rev: getRev(uid) } : { ok: true }
        })
      }))

      use('list', handle('GET', async () => ({ files: (await walk(root, '')).sort() })))

      use('rev', handle('GET', async req => {
        const url = new URL(req.url, 'http://localhost')
        const uid = checkUid(url.searchParams.get('uid'))
        return { uid, rev: getRev(uid) }
      }))

      use('snapshot', handle('GET', async req => {
        const url = new URL(req.url, 'http://localhost')
        const globalText = await readText(path.join(root, 'global.json'))
        const parsedGlobal = globalText === null ? null : parseMaybe(globalText)
        const global = parsedGlobal && typeof parsedGlobal === 'object' ? parsedGlobal : null
        const uid = checkUid(url.searchParams.get('uid') || global?.activeUser || 'default')
        return withLock(uid, async () => {
          const rev = getRev(uid)
          const rels = await walk(path.join(root, 'users', uid), `users/${uid}`)
          const metaPath = `users/${uid}/meta.json`
          let meta = null
          const files = {}
          await Promise.all(rels.map(async rel => {
            const text = await readText(path.join(root, rel))
            if (text === null) return
            const v = parseMaybe(text)
            if (rel === metaPath) meta = v
            else files[rel] = v
          }))
          return { uid, rev, global, meta, files }
        })
      }))

      use('sync', handle('POST', async req => {
        const { uid: rawUid, files } = await readBody(req)
        const uid = checkUid(rawUid)
        if (!Array.isArray(files)) throw new HttpError(400, 'files must be an array')
        const prefix = `users/${uid}/`
        const items = new Map()
        for (const f of files) {
          const p = f && f.path
          if (typeof p !== 'string' || !p.startsWith(prefix) || !p.endsWith('.json') || p.endsWith('/meta.json'))
            throw new HttpError(400, `bad day file path: ${p}`)
          items.set(p, {
            path: p,
            full: resolveSafe(p),
            cards: Array.isArray(f.cards) ? f.cards : [],
            dropIds: new Set(Array.isArray(f.dropIds) ? f.dropIds : []),
          })
        }
        return withLock(uid, async () => {
          const prevRev = getRev(uid)
          let changed = false
          const results = {}
          try {
            await Promise.all([...items.values()].map(async it => {
              let text = await readText(it.full)
              let disk = []
              if (text !== null) {
                const v = parseMaybe(text)
                if (Array.isArray(v)) disk = v
                else { await quarantine(it.full); text = null }
              }
              const ids = new Set(it.cards.map(c => c && c.id))
              const extra = disk.filter(c => c && typeof c === 'object' &&
                (!c.id || (!ids.has(c.id) && !it.dropIds.has(c.id))))
              const out = [...it.cards, ...extra]
              if (out.length) {
                const s = JSON.stringify(out, null, 2)
                if (s !== text) { await atomicWrite(it.full, s); changed = true }
                results[it.path] = { exists: true, foreign: extra.filter(c => c.id) }
              } else {
                if (text !== null) { await removeFile(it.full); changed = true }
                results[it.path] = { exists: false, foreign: [] }
              }
            }))
          } finally {
            if (changed) bumpRev(uid)
          }
          return { uid, prevRev, rev: getRev(uid), results }
        })
      }))

      // GET /api/tts?q=text&tl=lang — proxy Google TTS to bypass referrer check
      use('tts', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        try {
          const url = new URL(req.url, 'http://localhost')
          const q = url.searchParams.get('q')
          const tl = url.searchParams.get('tl') || 'en'
          if (!q) { res.statusCode = 400; res.end(); return }
          const https = await import('https')
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(q)}&tl=${encodeURIComponent(tl)}&client=tw-ob`
          https.default.get(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://translate.google.com/' } }, (proxyRes) => {
            res.statusCode = proxyRes.statusCode || 502
            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/mpeg')
            if (res.statusCode === 200) res.setHeader('Cache-Control', 'public, max-age=86400')
            proxyRes.pipe(res)
          }).on('error', () => { res.statusCode = 502; res.end() })
        } catch (e) { res.statusCode = 500; res.end() }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), fileStoragePlugin(DATA_DIR, BASE_PATH)],
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
  base: `${BASE_PATH}/`,
  server: {
    host: HOST,
    port: PORT,
    open: false,
    allowedHosts: true,
  },
})
