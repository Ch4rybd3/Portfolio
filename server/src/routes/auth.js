const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db')

const router = express.Router()

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

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié' })
  res.json({ id: req.session.userId, username: req.session.username })
})

module.exports = router
