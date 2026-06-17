const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

/* ── Password policy ── */
function validatePassword(pwd) {
  const errors = []
  if (!pwd || pwd.length < 8)           errors.push('8 caractères minimum')
  if (!/[A-Z]/.test(pwd))               errors.push('Au moins une majuscule')
  if (!/[a-z]/.test(pwd))               errors.push('Au moins une minuscule')
  if (!/[0-9]/.test(pwd))               errors.push('Au moins un chiffre')
  if (!/[^A-Za-z0-9]/.test(pwd))        errors.push('Au moins un caractère spécial')
  return errors
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' })

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' })

  req.session.userId = user.id
  req.session.username = user.username
  res.json({ ok: true })
})

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Champs requis' })

  // Policy check
  const errors = validatePassword(newPassword)
  if (errors.length)
    return res.status(400).json({ error: errors.join(' · ') })

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' })

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' })

  const hash = await bcrypt.hash(newPassword, 12)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  res.json({ ok: true })
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié' })
  res.json({ id: req.session.userId, username: req.session.username })
})

module.exports = router
