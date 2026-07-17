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
      '<div class="empty-state"><i class="fa fa-triangle-exclamation"></i>Failed to load</div>'
  }
}

function render() {
  const list = document.getElementById('articlesList')
  const items = activeFilter === 'all' ? allArticles : allArticles.filter(a => a.status === activeFilter)

  if (!items.length) {
    list.innerHTML = '<div class="empty-state"><i class="fa fa-file-circle-plus"></i>No articles — create one!</div>'
    return
  }

  list.innerHTML = items.map(a => `
    <div class="article-row">
      <div>
        <div class="article-title">${escHtml(a.title)}</div>
        <div class="article-meta">
          ${formatDate(a.updated_at)} &bull;
          ${a.status === 'published' ? `published ${formatDate(a.published_at)}` : 'draft'}
        </div>
      </div>
      <span class="badge badge-${a.status}">${a.status === 'published' ? 'Published' : 'Draft'}</span>
      <div class="article-actions">
        <a href="/admin/editor?id=${a.id}" class="btn btn-ghost btn-sm"><i class="fa fa-pen"></i> Edit</a>
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
  if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return
  try {
    await api.delete(`/api/articles/${id}`)
    toast('Article deleted')
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
function formatDate(d) { return d ? new Date(d).toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }) : '—' }

/* ════════════════════════════════════════════════
   CHANGE PASSWORD MODAL
════════════════════════════════════════════════ */
const RULES = [
  { id: 'rule-len',     test: p => p.length >= 8,           label: 'At least 8 characters' },
  { id: 'rule-upper',   test: p => /[A-Z]/.test(p),         label: 'One uppercase letter' },
  { id: 'rule-lower',   test: p => /[a-z]/.test(p),         label: 'One lowercase letter' },
  { id: 'rule-digit',   test: p => /[0-9]/.test(p),         label: 'One digit' },
  { id: 'rule-special', test: p => /[^A-Za-z0-9]/.test(p),  label: 'One special character' },
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

/* ════════════════════════════════════════════════
   EXPORT
════════════════════════════════════════════════ */
function triggerExport(url) {
  window.open(url, '_blank')
}

document.getElementById('exportArticlesBtn').addEventListener('click', () => triggerExport('/api/export/articles'))
document.getElementById('exportKbBtn').addEventListener('click',       () => triggerExport('/api/export/docs?section=kb'))
document.getElementById('exportRemoraBtn').addEventListener('click',   () => triggerExport('/api/export/docs?section=remora'))

/* ════════════════════════════════════════════════
   IMPORT / RESTORE (docs)
════════════════════════════════════════════════ */
let importMode = 'merge'
const importInput = document.getElementById('importFileInput')
document.getElementById('importMergeBtn').addEventListener('click',   () => { importMode = 'merge';   importInput.click() })
document.getElementById('importReplaceBtn').addEventListener('click', () => { importMode = 'replace'; importInput.click() })

importInput.addEventListener('change', async e => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const out = document.getElementById('importResult')
  out.textContent = ''

  let data
  try { data = JSON.parse(await file.text()) } catch { out.textContent = '✗ Invalid JSON file'; return }
  const notes = Array.isArray(data?.notes) ? data.notes : (Array.isArray(data) ? data : null)
  if (!notes || !notes.length) { out.textContent = '✗ No notes found in this file'; return }

  const sections = [...new Set(notes.map(n => n?.section === 'remora' ? 'remora' : 'kb'))].join(', ')
  const msg = importMode === 'replace'
    ? `⚠ FULL RESTORE\n\nAll current notes in sections [${sections}] will be DELETED, then replaced by the ${notes.length} notes from "${file.name}".\n\nContinue?`
    : `Merge the ${notes.length} notes from "${file.name}" (sections: ${sections}) with existing content?\n\nNotes at the same path will be overwritten, everything else is kept.`
  if (!confirm(msg)) return

  out.textContent = 'Importing…'
  try {
    const r = await fetch('/api/export/docs/import', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, mode: importMode })
    })
    if (r.status === 401) { location.href = '/admin/login'; return }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { out.textContent = `✗ ${j.error || 'Import failed'}`; return }
    out.textContent = `✓ ${j.imported} note${j.imported > 1 ? 's' : ''} imported (${j.mode === 'replace' ? 'replace' : 'merge'})`
      + (j.removed ? ` · ${j.removed} removed` : '')
      + (j.skipped ? `\n⚠ ${j.skipped} skipped: ${j.errors.join('; ')}` : '')
  } catch { out.textContent = '✗ Network error during import' }
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

  if (!current)            { errEl.textContent = 'Enter your current password.'; return }
  if (!policyValid(newPwd)){ errEl.textContent = 'The new password does not meet the policy.'; return }
  if (newPwd !== confirm)  { errEl.textContent = 'The two passwords do not match.'; return }

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
    toast('Password updated ✓')
  } catch { errEl.textContent = 'Network error.' }
  finally { btn.disabled = false }
})

load()
