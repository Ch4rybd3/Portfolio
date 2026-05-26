const express = require('express')
const slugify = require('slugify')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Public — articles publiés
router.get('/', (req, res) => {
  res.json(db.prepare(
    `SELECT id, title, slug, excerpt, cover_image, published_at, created_at
     FROM articles WHERE status = 'published' ORDER BY published_at DESC`
  ).all())
})

router.get('/public/:slug', (req, res) => {
  const a = db.prepare(`SELECT * FROM articles WHERE slug = ? AND status = 'published'`).get(req.params.slug)
  if (!a) return res.status(404).json({ error: 'Introuvable' })
  res.json(a)
})

// Admin — tous les articles
router.get('/admin', requireAuth, (req, res) => {
  res.json(db.prepare(
    `SELECT id, title, slug, status, excerpt, cover_image, published_at, created_at, updated_at
     FROM articles ORDER BY updated_at DESC`
  ).all())
})

router.get('/admin/:id', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id)
  if (!a) return res.status(404).json({ error: 'Introuvable' })
  res.json(a)
})

router.post('/', requireAuth, (req, res) => {
  const { title, content, excerpt, cover_image, status } = req.body
  if (!title) return res.status(400).json({ error: 'Titre requis' })

  const base = slugify(title, { lower: true, strict: true })
  let slug = base, i = 1
  while (db.prepare('SELECT id FROM articles WHERE slug = ?').get(slug)) slug = `${base}-${i++}`

  const result = db.prepare(
    `INSERT INTO articles (title, slug, content, excerpt, cover_image, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title, slug, content || '', excerpt || '', cover_image || null,
    status || 'draft',
    status === 'published' ? new Date().toISOString() : null
  )
  res.status(201).json(db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid))
})

router.put('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Introuvable' })

  const { title, content, excerpt, cover_image, status } = req.body
  const published_at = status === 'published' && !existing.published_at
    ? new Date().toISOString() : existing.published_at

  db.prepare(
    `UPDATE articles SET title=?, content=?, excerpt=?, cover_image=?, status=?,
     published_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(
    title ?? existing.title, content ?? existing.content, excerpt ?? existing.excerpt,
    cover_image ?? existing.cover_image, status ?? existing.status,
    published_at, req.params.id
  )
  res.json(db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id))
})

router.delete('/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id)
  if (r.changes === 0) return res.status(404).json({ error: 'Introuvable' })
  res.json({ ok: true })
})

module.exports = router
