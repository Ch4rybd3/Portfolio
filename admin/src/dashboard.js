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

load()
