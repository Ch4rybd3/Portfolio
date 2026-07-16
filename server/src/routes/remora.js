const express = require('express')
const db      = require('../db')

const router = express.Router()

const { parseNote, PUBLIC_SQL } = require('../docs-utils')

function notePath(req) { return req.params[0] || '' }

// GET /api/remora  — tree of published Remora notes
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT path, title, properties, updated_at
    FROM docs_notes WHERE published = 1 AND section = 'remora' AND ${PUBLIC_SQL} ORDER BY path
  `).all()
  res.json(rows.map(parseNote))
})

// GET /api/remora/note/*  — single published Remora note
router.get('/note/*', (req, res) => {
  const p = notePath(req)
  const row = db.prepare(`SELECT * FROM docs_notes WHERE path = ? AND published = 1 AND section = 'remora' AND ${PUBLIC_SQL}`).get(p)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(parseNote(row))
})

module.exports = router
