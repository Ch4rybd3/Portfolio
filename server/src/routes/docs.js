const express = require('express')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const db      = require('../db')
const { requireAuth } = require('../middleware/auth')

const DOC_UPLOADS_DIR = process.env.DOC_UPLOADS_DIR || path.join(__dirname, '../../../doc-uploads')
if (!fs.existsSync(DOC_UPLOADS_DIR)) fs.mkdirSync(DOC_UPLOADS_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: DOC_UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  }
})
const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'])

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png'
    if (!file.mimetype.startsWith('image/') || !ALLOWED_IMAGE_EXTS.has(ext)) {
      return cb(new Error('Images only (jpg, png, gif, webp, avif)'))
    }
    cb(null, true)
  }
})

const DIAGRAM_DIR = path.join(DOC_UPLOADS_DIR, 'excalidraw')
if (!fs.existsSync(DIAGRAM_DIR)) fs.mkdirSync(DIAGRAM_DIR, { recursive: true })

const router = express.Router()

const { parseNote, pathError, PUBLIC_SQL, regenerateRootMoc, buildGraph } = require('../docs-utils')

/* ── helpers ── */
function notePath(req) { return req.params[0] || '' }

/* ══════════════════════════════════════════════
   PUBLIC routes  (Knowledge Base — section = 'kb')
══════════════════════════════════════════════ */

// GET /api/docs  — full tree (path + title + properties, no content)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT path, title, properties, updated_at
    FROM docs_notes WHERE published = 1 AND section = 'kb' AND ${PUBLIC_SQL} ORDER BY path
  `).all()
  res.json(rows.map(parseNote))
})

// GET /api/docs/note/*  — single published KB note with content
router.get('/note/*', (req, res) => {
  const p = notePath(req)
  const row = db.prepare(`SELECT * FROM docs_notes WHERE path = ? AND published = 1 AND section = 'kb' AND ${PUBLIC_SQL}`).get(p)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(parseNote(row))
})

// GET /api/docs/graph  — relation graph (wikilinks), published+public KB notes only
router.get('/graph', (req, res) => res.json(buildGraph('kb', { publicOnly: true })))

/* ══════════════════════════════════════════════
   ADMIN routes  (auth required)
══════════════════════════════════════════════ */

// GET /api/docs/admin/all  — all notes for a section (incl. drafts)
router.get('/admin/all', requireAuth, (req, res) => {
  const section = req.query.section || 'kb'
  const rows = db.prepare('SELECT path, title, properties, published, updated_at FROM docs_notes WHERE section = ? ORDER BY path').all(section)
  res.json(rows.map(parseNote))
})

// GET /api/docs/admin/graph  — relation graph (wikilinks), all notes incl. drafts/private
router.get('/admin/graph', requireAuth, (req, res) => res.json(buildGraph(req.query.section || 'kb', { publicOnly: false })))

// GET /api/docs/admin/note/*  — full note with content
router.get('/admin/note/*', requireAuth, (req, res) => {
  const p = notePath(req)
  const row = db.prepare('SELECT * FROM docs_notes WHERE path = ?').get(p)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(parseNote(row))
})

// PUT /api/docs/admin/note/*  — create or update
router.put('/admin/note/*', requireAuth, (req, res) => {
  const p = notePath(req)
  const err = pathError(p)
  if (err) return res.status(400).json({ error: err })
  const { title = 'Untitled', content = '', properties = {}, published = true, section = 'kb' } = req.body

  // Métadonnées automatiques : `created`/`creator` figés à la création,
  // `updated` réécrit à chaque sauvegarde. Le serveur fait autorité sur ces clés.
  const existing = db.prepare('SELECT properties, created_at FROM docs_notes WHERE path = ?').get(p)
  const prevProps = existing ? JSON.parse(existing.properties || '{}') : {}
  const today = new Date().toISOString().slice(0, 10)
  const props = {
    ...properties,
    created: prevProps.created || (existing?.created_at || '').slice(0, 10) || today,
    creator: prevProps.creator || req.session.username || 'admin',
    updated: today,
  }

  db.prepare(`
    INSERT INTO docs_notes (path, title, content, properties, published, section, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      properties = excluded.properties,
      published = excluded.published,
      section = excluded.section,
      updated_at = CURRENT_TIMESTAMP
  `).run(p, title, content, JSON.stringify(props), published ? 1 : 0, section)
  if (p !== 'moc') regenerateRootMoc(section)
  res.json({ ok: true, path: p, properties: props })
})

// PATCH /api/docs/admin/move/*  — rename/move (change path)
router.patch('/admin/move/*', requireAuth, (req, res) => {
  const oldPath = notePath(req)
  const { newPath } = req.body
  const err = pathError(newPath)
  if (err) return res.status(400).json({ error: err })
  try {
    const row = db.prepare('SELECT section FROM docs_notes WHERE path = ?').get(oldPath)
    db.prepare('UPDATE docs_notes SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?').run(newPath, oldPath)
    if (row) regenerateRootMoc(row.section)
    res.json({ ok: true, path: newPath })
  } catch {
    res.status(409).json({ error: 'Path already exists' })
  }
})

// PATCH /api/docs/admin/move-folder  — rename/move a whole folder (prefix rewrite)
router.patch('/admin/move-folder', requireAuth, (req, res) => {
  const { oldPath, newPath, section = 'kb' } = req.body
  if (!oldPath) return res.status(400).json({ error: 'oldPath required' })
  const err = pathError(newPath)
  if (err) return res.status(400).json({ error: err })
  if (oldPath === newPath) return res.json({ ok: true, path: newPath, moved: 0 })
  if (newPath.startsWith(oldPath + '/')) return res.status(400).json({ error: 'Cannot move a folder into itself' })

  const moved = db.prepare(`SELECT path FROM docs_notes WHERE section = ? AND path LIKE ? ESCAPE '\\'`)
    .all(section, oldPath.replace(/[\\%_]/g, '\\$&') + '/%')
  if (!moved.length) return res.json({ ok: true, path: newPath, moved: 0 })

  try {
    db.transaction(() => {
      const movedSet = new Set(moved.map(r => r.path))
      const clashStmt = db.prepare('SELECT 1 FROM docs_notes WHERE path = ?')
      for (const r of moved) {
        const target = newPath + r.path.slice(oldPath.length)
        if (!movedSet.has(target) && clashStmt.get(target)) {
          const e = new Error(`A note already exists at ${target}`); e.conflict = true; throw e
        }
      }
      const upd = db.prepare('UPDATE docs_notes SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?')
      for (const r of moved) upd.run(newPath + r.path.slice(oldPath.length), r.path)
    })()
    regenerateRootMoc(section)
    res.json({ ok: true, path: newPath, moved: moved.length })
  } catch (e) {
    res.status(e.conflict ? 409 : 500).json({ error: e.message })
  }
})

// DELETE /api/docs/admin/note/*
router.delete('/admin/note/*', requireAuth, (req, res) => {
  const p = notePath(req)
  const row = db.prepare('SELECT section FROM docs_notes WHERE path = ?').get(p)
  db.prepare('DELETE FROM docs_notes WHERE path = ?').run(p)
  if (row && p !== 'moc') regenerateRootMoc(row.section)
  res.json({ ok: true })
})

/* ── Templates ── */

function parseTemplate(r) {
  return { ...r, tags: JSON.parse(r.tags || '[]'), properties: JSON.parse(r.properties || '{}') }
}

// GET /api/docs/admin/templates
router.get('/admin/templates', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM docs_templates ORDER BY name COLLATE NOCASE').all()
  res.json(rows.map(parseTemplate))
})

// PUT /api/docs/admin/templates  — create or update by name (upsert)
router.put('/admin/templates', requireAuth, (req, res) => {
  const { name, content = '', tags = [], properties = {} } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    db.prepare(`
      INSERT INTO docs_templates (name, content, tags, properties, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        content    = excluded.content,
        tags       = excluded.tags,
        properties = excluded.properties,
        updated_at = CURRENT_TIMESTAMP
    `).run(name.trim(), content, JSON.stringify(tags), JSON.stringify(properties))
    const row = db.prepare('SELECT * FROM docs_templates WHERE name = ?').get(name.trim())
    res.json(parseTemplate(row))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/docs/admin/templates/:id
router.delete('/admin/templates/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM docs_templates WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// POST /api/docs/admin/upload  — image upload (saved to public doc-uploads dir)
router.post('/admin/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ url: `/doc-uploads/${req.file.filename}` })
})

// POST /api/docs/admin/upload-diagram  — Excalidraw scene (editable source, JSON)
router.post('/admin/upload-diagram', requireAuth, (req, res) => {
  const scene = req.body?.scene
  if (!scene) return res.status(400).json({ error: 'scene required' })
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  fs.writeFileSync(path.join(DIAGRAM_DIR, filename), JSON.stringify(scene))
  res.json({ url: `/doc-uploads/excalidraw/${filename}` })
})

module.exports = router
