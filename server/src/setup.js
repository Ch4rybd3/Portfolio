require('dotenv').config()
const bcrypt = require('bcryptjs')
const readline = require('readline')
const db = require('./db')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise(r => rl.question(q, r))

;(async () => {
  const username = await ask('Username: ')
  const password = await ask('Password: ')
  const hash = await bcrypt.hash(password, 12)

  try {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash)
    console.log(`✓ Admin "${username}" créé`)
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username)
      console.log(`✓ Mot de passe mis à jour pour "${username}"`)
    } else throw e
  }

  rl.close()
  process.exit(0)
})()
