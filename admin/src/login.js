import './style.css'

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.target.querySelector('button[type=submit]')
  const err = document.getElementById('errorMsg')
  btn.disabled = true
  err.textContent = ''

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      })
    })
    const data = await res.json()
    if (!res.ok) { err.textContent = data.error; btn.disabled = false; return }
    window.location.href = '/admin'
  } catch {
    err.textContent = 'Erreur réseau'
    btn.disabled = false
  }
})
