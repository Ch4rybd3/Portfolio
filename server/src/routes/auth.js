const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')
const { loginRateLimit, recordLoginFailure, clearLoginFailures } = require('../middleware/rate-limit')

const router = express.Router()

/* ── Password policy ── */
function validatePassword(pwd) {
  const errors = []
  if (!pwd || pwd.length < 8)           errors.push('At least 8 characters')
  if (!/[A-Z]/.test(pwd))               errors.push('At least one uppercase letter')
  if (!/[a-z]/.test(pwd))               errors.push('At least one lowercase letter')
  if (!/[0-9]/.test(pwd))               errors.push('At least one digit')
  if (!/[^A-Za-z0-9]/.test(pwd))        errors.push('At least one special character')
  return errors
}

router.post('/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' })

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) { recordLoginFailure(req); return res.status(401).json({ error: 'Invalid credentials' }) }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) { recordLoginFailure(req); return res.status(401).json({ error: 'Invalid credentials' }) }

  // Nouvel ID de session à la connexion (anti fixation de session)
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' })
    req.session.userId = user.id
    req.session.username = user.username
    clearLoginFailures(req)
    res.json({ ok: true })
  })
})

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Missing fields' })

  // Policy check
  const errors = validatePassword(newPassword)
  if (errors.length)
    return res.status(400).json({ error: errors.join(' · ') })

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)
  if (!user) return res.status(401).json({ error: 'User not found' })

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' })

  const hash = await bcrypt.hash(newPassword, 12)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  res.json({ ok: true })
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' })
  res.json({ id: req.session.userId, username: req.session.username })
})

module.exports = router
