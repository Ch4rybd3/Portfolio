const express = require('express')
const db      = require('../db')
const { requireAuth } = require('../middleware/auth')
const { parseNote, pathError, regenerateRootMoc } = require('../docs-utils')

const router = express.Router()

// GET /api/export/articles  — all articles as JSON download
router.get('/articles', requireAuth, (req, res) => {
  const articles = db.prepare(`
    SELECT id, title, slug, content, excerpt, cover_image, status, tags,
           published_at, created_at, updated_at
    FROM articles ORDER BY created_at DESC
  `).all().map(a => ({ ...a, tags: JSON.parse(a.tags || '[]') }))

  const filename = `articles-export-${new Date().toISOString().slice(0,10)}.json`
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.json({ exported_at: new Date().toISOString(), count: articles.length, articles })
})

// GET /api/export/docs?section=kb|remora  — docs notes as JSON download
router.get('/docs', requireAuth, (req, res) => {
  const section = req.query.section
  const validSections = ['kb', 'remora']

  let rows
  let label
  if (!section || !validSections.includes(section)) {
    rows = db.prepare(`SELECT * FROM docs_notes ORDER BY section, path`).all()
    label = 'all'
  } else {
    rows = db.prepare(`SELECT * FROM docs_notes WHERE section = ? ORDER BY path`).all(section)
    label = section
  }

  const notes = rows.map(parseNote)
  const filename = `docs-${label}-export-${new Date().toISOString().slice(0,10)}.json`
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.json({ exported_at: new Date().toISOString(), section: label, count: notes.length, notes })
})

// POST /api/export/docs/import  — restore a docs backup
// body: { notes: [...], mode: 'merge' | 'replace' }
//   merge   : upsert par chemin, l'existant non présent dans le fichier est conservé
//   replace : les sections présentes dans le fichier sont vidées puis réimportées
router.post('/docs/import', requireAuth, (req, res) => {
  const { notes, mode = 'merge' } = req.body
  if (!Array.isArray(notes) || !notes.length) return res.status(400).json({ error: 'No notes in the file' })
  if (!['merge', 'replace'].includes(mode)) return res.status(400).json({ error: 'invalid mode (merge | replace)' })

  const VALID_SECTIONS = ['kb', 'remora']
  const errors = []
  const clean = []
  notes.forEach((n, i) => {
    const path = typeof n?.path === 'string' ? n.path.trim() : ''
    const err = pathError(path)
    if (err) { errors.push(`note ${i + 1}${path ? ` (${path})` : ''} : ${err}`); return }
    const properties = (n.properties && typeof n.properties === 'object' && !Array.isArray(n.properties)) ? n.properties : {}
    clean.push({
      path,
      title:      typeof n.title === 'string' && n.title.trim() ? n.title.trim() : 'Untitled',
      content:    typeof n.content === 'string' ? n.content : '',
      properties: JSON.stringify(properties),
      published:  n.published ? 1 : 0,
      section:    VALID_SECTIONS.includes(n.section) ? n.section : 'kb',
      created_at: typeof n.created_at === 'string' ? n.created_at : null,
    })
  })
  if (!clean.length) return res.status(400).json({ error: 'No valid notes in the file', details: errors.slice(0, 10) })

  // Chemins dupliqués dans le fichier : la dernière occurrence gagne
  const finalNotes = [...new Map(clean.map(n => [n.path, n])).values()]
  const sections = [...new Set(finalNotes.map(n => n.section))]

  let removed = 0
  try {
    db.transaction(() => {
      if (mode === 'replace') {
        const del = db.prepare('DELETE FROM docs_notes WHERE section = ?')
        sections.forEach(s => { removed += del.run(s).changes })
      }
      const up = db.prepare(`
        INSERT INTO docs_notes (path, title, content, properties, published, section, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        ON CONFLICT(path) DO UPDATE SET
          title      = excluded.title,
          content    = excluded.content,
          properties = excluded.properties,
          published  = excluded.published,
          section    = excluded.section,
          updated_at = CURRENT_TIMESTAMP
      `)
      finalNotes.forEach(n => up.run(n.path, n.title, n.content, n.properties, n.published, n.section, n.created_at))
    })()
    sections.forEach(s => regenerateRootMoc(s))
    res.json({
      ok: true, mode, sections,
      imported: finalNotes.length,
      removed:  mode === 'replace' ? removed : 0,
      skipped:  errors.length,
      errors:   errors.slice(0, 10),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
