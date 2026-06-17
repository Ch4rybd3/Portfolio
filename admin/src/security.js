import './style.css'

const RULES = [
  { id: 'rule-len',     test: p => p.length >= 8 },
  { id: 'rule-upper',   test: p => /[A-Z]/.test(p) },
  { id: 'rule-lower',   test: p => /[a-z]/.test(p) },
  { id: 'rule-digit',   test: p => /[0-9]/.test(p) },
  { id: 'rule-special', test: p => /[^A-Za-z0-9]/.test(p) },
]

function policyValid(pwd) { return RULES.every(r => r.test(pwd)) }

function updatePolicy(pwd) {
  RULES.forEach(r => {
    const el = document.getElementById(r.id)
    const ok = r.test(pwd)
    el.classList.toggle('ok', ok)
    el.querySelector('.fa').className = `fa ${ok ? 'fa-circle-check' : 'fa-circle'}`
  })
}

document.getElementById('newPwd').addEventListener('input', function () {
  updatePolicy(this.value)
  document.getElementById('formError').textContent = ''
})

document.getElementById('submitBtn').addEventListener('click', async () => {
  const current = document.getElementById('currentPwd').value
  const newPwd  = document.getElementById('newPwd').value
  const confirm = document.getElementById('confirmPwd').value
  const errEl   = document.getElementById('formError')
  errEl.textContent = ''

  if (!current)             { errEl.textContent = 'Saisissez votre mot de passe actuel.'; return }
  if (!policyValid(newPwd)) { errEl.textContent = 'Le nouveau mot de passe ne respecte pas la politique.'; return }
  if (newPwd !== confirm)   { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return }

  const btn = document.getElementById('submitBtn')
  btn.disabled = true
  btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enregistrement…'

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPwd })
    })
    const data = await res.json()
    if (res.status === 401) { location.href = '/admin/login'; return }
    if (!res.ok) { errEl.textContent = data.error; return }

    // Success — clear fields and show confirmation
    document.getElementById('currentPwd').value = ''
    document.getElementById('newPwd').value = ''
    document.getElementById('confirmPwd').value = ''
    updatePolicy('')
    btn.innerHTML = '<i class="fa fa-circle-check"></i> Enregistré'
    btn.style.background = 'rgba(45,212,191,.15)'
    setTimeout(() => {
      btn.innerHTML = '<i class="fa fa-floppy-disk"></i> Enregistrer'
      btn.style.background = ''
    }, 2500)
  } catch {
    errEl.textContent = 'Erreur réseau.'
  } finally {
    btn.disabled = false
  }
})

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  location.href = '/admin/login'
})

// Redirect to login if not authenticated
fetch('/api/auth/me', { credentials: 'include' }).then(r => {
  if (!r.ok) location.href = '/admin/login'
})
