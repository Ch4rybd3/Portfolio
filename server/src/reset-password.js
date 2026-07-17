#!/usr/bin/env node
/**
 * Reset admin password — local only, no server access required.
 * Run: node server/src/reset-password.js
 */
require('dotenv').config()
const bcrypt = require('bcryptjs')
const readline = require('readline')
const db = require('./db')

function validatePassword(pwd) {
  const errors = []
  if (!pwd || pwd.length < 8)        errors.push('At least 8 characters')
  if (!/[A-Z]/.test(pwd))            errors.push('At least one uppercase letter')
  if (!/[a-z]/.test(pwd))            errors.push('At least one lowercase letter')
  if (!/[0-9]/.test(pwd))            errors.push('At least one digit')
  if (!/[^A-Za-z0-9]/.test(pwd))     errors.push('At least one special character')
  return errors
}

function hiddenInput(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    let input = ''
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false)
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(input)
      } else if (char === '') {
        process.stdout.write('\n')
        process.exit(1)
      } else if (char === '' || char === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += char
        process.stdout.write('*')
      }
    }

    process.stdin.on('data', onData)
  })
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()) })
  })
}

;(async () => {
  console.log('\n── Admin password reset ──\n')

  const users = db.prepare('SELECT id, username FROM users').all()
  if (users.length === 0) {
    console.error('No user found in database.')
    process.exit(1)
  }

  if (users.length === 1) {
    console.log(`User: ${users[0].username}`)
    var targetUser = users[0]
  } else {
    console.log('Available users:')
    users.forEach((u, i) => console.log(`  [${i + 1}] ${u.username}`))
    const choice = await ask('Choose a user (number): ')
    const idx = parseInt(choice, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= users.length) {
      console.error('Invalid choice.')
      process.exit(1)
    }
    var targetUser = users[idx]
  }

  let newPassword
  while (true) {
    newPassword = await hiddenInput('New password: ')
    const errors = validatePassword(newPassword)
    if (errors.length) {
      console.log(`\nInvalid password:\n  - ${errors.join('\n  - ')}\n`)
      continue
    }
    const confirm = await hiddenInput('Confirm password: ')
    if (newPassword !== confirm) {
      console.log('\nPasswords do not match. Try again.\n')
      continue
    }
    break
  }

  const hash = await bcrypt.hash(newPassword, 12)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, targetUser.id)
  console.log(`\n✓ Password updated for "${targetUser.username}"\n`)
  process.exit(0)
})()
