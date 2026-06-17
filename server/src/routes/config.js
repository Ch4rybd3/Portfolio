const express = require('express')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Allowlist of config keys readable without authentication (public portfolio display)
const PUBLIC_KEYS = new Set([
  'portfolio.hero', 'portfolio.about', 'portfolio.career',
  'portfolio.skills', 'portfolio.projects', 'portfolio.contact',
  'site.title', 'site.description', 'site.social'
])

// Public — read a config key (allowlisted keys only)
router.get('/:key', (req, res) => {
  if (!PUBLIC_KEYS.has(req.params.key)) return res.status(404).json({ error: 'Not found' })
  const row = db.prepare('SELECT value FROM site_config WHERE key = ?').get(req.params.key)
  if (!row) return res.status(404).json({ error: 'Not found' })
  try { res.json(JSON.parse(row.value)) }
  catch { res.json(row.value) }
})

// Admin — list all keys
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, updated_at FROM site_config ORDER BY key').all()
  res.json(rows)
})

// Admin — update a key
router.put('/:key', requireAuth, (req, res) => {
  const { key } = req.params
  const value = JSON.stringify(req.body)
  db.prepare(`
    INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value)
  res.json({ ok: true, key })
})

module.exports = router
