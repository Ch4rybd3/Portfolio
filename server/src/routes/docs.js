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
      return cb(new Error('Images uniquement (jpg, png, gif, webp, avif)'))
    }
    cb(null, true)
  }
})

const router = express.Router()

/* ── helpers ── */
function notePath(req) { return req.params[0] || '' }
function parseNote(n) {
  if (!n) return null
  return { ...n, properties: JSON.parse(n.properties || '{}') }
}

/* ══════════════════════════════════════════════
   PUBLIC routes
══════════════════════════════════════════════ */

// GET /api/docs  — full tree (path + title + properties, no content)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT path, title, properties, updated_at
    FROM docs_notes WHERE published = 1 ORDER BY path
  `).all()
  res.json(rows.map(parseNote))
})

// GET /api/docs/note/*  — single published note with content
router.get('/note/*', (req, res) => {
  const p = notePath(req)
  const row = db.prepare('SELECT * FROM docs_notes WHERE path = ? AND published = 1').get(p)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(parseNote(row))
})

/* ══════════════════════════════════════════════
   ADMIN routes  (auth required)
══════════════════════════════════════════════ */

// GET /api/docs/admin/all  — all notes (incl. drafts)
router.get('/admin/all', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT path, title, properties, published, updated_at FROM docs_notes ORDER BY path').all()
  res.json(rows.map(parseNote))
})

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
  if (!p) return res.status(400).json({ error: 'Path required' })
  const { title = 'Untitled', content = '', properties = {}, published = true } = req.body
  db.prepare(`
    INSERT INTO docs_notes (path, title, content, properties, published, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      properties = excluded.properties,
      published = excluded.published,
      updated_at = CURRENT_TIMESTAMP
  `).run(p, title, content, JSON.stringify(properties), published ? 1 : 0)
  res.json({ ok: true, path: p })
})

// PATCH /api/docs/admin/move/*  — rename/move (change path)
router.patch('/admin/move/*', requireAuth, (req, res) => {
  const oldPath = notePath(req)
  const { newPath } = req.body
  if (!newPath) return res.status(400).json({ error: 'newPath required' })
  try {
    db.prepare('UPDATE docs_notes SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?').run(newPath, oldPath)
    res.json({ ok: true, path: newPath })
  } catch {
    res.status(409).json({ error: 'Path already exists' })
  }
})

// DELETE /api/docs/admin/note/*
router.delete('/admin/note/*', requireAuth, (req, res) => {
  const p = notePath(req)
  db.prepare('DELETE FROM docs_notes WHERE path = ?').run(p)
  res.json({ ok: true })
})

/* ── Templates ── */

// GET /api/docs/admin/templates
router.get('/admin/templates', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM docs_templates ORDER BY name COLLATE NOCASE').all()
  res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })))
})

// PUT /api/docs/admin/templates/:id  — create (id=0) or update (id>0) by name (upsert)
router.put('/admin/templates', requireAuth, (req, res) => {
  const { name, content = '', tags = [] } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    db.prepare(`
      INSERT INTO docs_templates (name, content, tags, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        content    = excluded.content,
        tags       = excluded.tags,
        updated_at = CURRENT_TIMESTAMP
    `).run(name.trim(), content, JSON.stringify(tags))
    const row = db.prepare('SELECT * FROM docs_templates WHERE name = ?').get(name.trim())
    res.json({ ...row, tags: JSON.parse(row.tags || '[]') })
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

module.exports = router
