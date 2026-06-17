import './style.css'
import { api, toast } from './api.js'

let allArticles = []
let activeFilter = 'all'

async function load() {
  try {
    allArticles = await api.get('/api/articles/admin')
    render()
  } catch {
    document.getElementById('articlesList').innerHTML =
      '<div class="empty-state"><i class="fa fa-triangle-exclamation"></i>Erreur de chargement</div>'
  }
}

function render() {
  const list = document.getElementById('articlesList')
  const items = activeFilter === 'all' ? allArticles : allArticles.filter(a => a.status === activeFilter)

  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><i class="fa fa-file-circle-plus"></i>Aucun article — créez-en un !</div>'
    return
  }

  list.innerHTML = items.map(a => `
    <div class="article-row">
      <div>
        <div class="article-title">${escHtml(a.title)}</div>
        <div class="article-meta">
          ${formatDate(a.updated_at)} &bull;
          ${a.status === 'published' ? `publié le ${formatDate(a.published_at)}` : 'brouillon'}
        </div>
      </div>
      <span class="badge badge-${a.status}">${a.status === 'published' ? 'Publié' : 'Brouillon'}</span>
      <div class="article-actions">
        <a href="/admin/editor?id=${a.id}" class="btn btn-ghost btn-sm"><i class="fa fa-pen"></i> Éditer</a>
        ${a.status === 'published' ? `<a href="/blog/${a.slug}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa fa-eye"></i></a>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" data-del="${a.id}"><i class="fa fa-trash"></i></button>
    </div>
  `).join('')

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.del)))
  })
}

async function confirmDelete(id) {
  const article = allArticles.find(a => a.id === id)
  if (!confirm(`Supprimer « ${article.title} » ? Cette action est irréversible.`)) return
  try {
    await api.delete(`/api/articles/${id}`)
    toast('Article supprimé')
    allArticles = allArticles.filter(a => a.id !== id)
    render()
  } catch (e) { toast(e.message, 'error') }
}

document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    activeFilter = tab.dataset.filter
    render()
  })
})

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api.post('/api/auth/logout')
  window.location.href = '/admin/login'
})

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function formatDate(d) { return d ? new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) : '—' }

/* ════════════════════════════════════════════════
   CHANGE PASSWORD MODAL
════════════════════════════════════════════════ */
const RULES = [
  { id: 'rule-len',     test: p => p.length >= 8,           label: '8 caractères minimum' },
  { id: 'rule-upper',   test: p => /[A-Z]/.test(p),         label: 'Une majuscule' },
  { id: 'rule-lower',   test: p => /[a-z]/.test(p),         label: 'Une minuscule' },
  { id: 'rule-digit',   test: p => /[0-9]/.test(p),         label: 'Un chiffre' },
  { id: 'rule-special', test: p => /[^A-Za-z0-9]/.test(p),  label: 'Un caractère spécial' },
]

function policyValid(pwd) { return RULES.every(r => r.test(pwd)) }

function updatePolicyUI(pwd) {
  RULES.forEach(r => {
    const el = document.getElementById(r.id)
    const ok = r.test(pwd)
    el.classList.toggle('ok', ok)
    el.querySelector('.fa').className = `fa ${ok ? 'fa-circle-check' : 'fa-circle'}`
  })
}

function openPwdModal() {
  document.getElementById('currentPwd').value = ''
  document.getElementById('newPwd').value = ''
  document.getElementById('confirmPwd').value = ''
  document.getElementById('pwdError').textContent = ''
  updatePolicyUI('')
  document.getElementById('pwdModalOverlay').classList.add('open')
  document.getElementById('currentPwd').focus()
}
function closePwdModal() {
  document.getElementById('pwdModalOverlay').classList.remove('open')
}

document.getElementById('changePwdBtn').addEventListener('click', openPwdModal)
document.getElementById('pwdModalClose').addEventListener('click', closePwdModal)
document.getElementById('pwdCancelBtn').addEventListener('click', closePwdModal)
document.getElementById('pwdModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('pwdModalOverlay')) closePwdModal()
})
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('pwdModalOverlay').classList.contains('open')) closePwdModal()
})

document.getElementById('newPwd').addEventListener('input', function () {
  updatePolicyUI(this.value)
  document.getElementById('pwdError').textContent = ''
})

document.getElementById('pwdSubmitBtn').addEventListener('click', async () => {
  const current = document.getElementById('currentPwd').value
  const newPwd  = document.getElementById('newPwd').value
  const confirm = document.getElementById('confirmPwd').value
  const errEl   = document.getElementById('pwdError')

  errEl.textContent = ''

  if (!current)            { errEl.textContent = 'Saisissez votre mot de passe actuel.'; return }
  if (!policyValid(newPwd)){ errEl.textContent = 'Le nouveau mot de passe ne respecte pas la politique.'; return }
  if (newPwd !== confirm)  { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return }

  const btn = document.getElementById('pwdSubmitBtn')
  btn.disabled = true
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: newPwd })
    })
    const data = await res.json()
    if (!res.ok) { errEl.textContent = data.error; return }
    closePwdModal()
    toast('Mot de passe mis à jour ✓')
  } catch { errEl.textContent = 'Erreur réseau.' }
  finally { btn.disabled = false }
})

load()
