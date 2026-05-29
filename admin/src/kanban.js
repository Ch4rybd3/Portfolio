import './style.css'
import { api, toast } from './api.js'

let board = []
let dragging = null        // { cardId, fromColId }
let modalCtx = null        // { mode: 'create'|'edit', columnId?, cardId? }

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  const el = document.getElementById('kanbanBoard')
  el.innerHTML = board.map(col => `
    <div class="kanban-column" data-col="${col.id}">
      <div class="col-header">
        <input class="col-title" value="${escHtml(col.title)}" data-col-title="${col.id}" title="Cliquer pour renommer"/>
        <span class="col-count">${col.cards.length}</span>
        <div class="col-actions">
          <button data-del-col="${col.id}" title="Supprimer la colonne"><i class="fa fa-trash-can"></i></button>
        </div>
      </div>
      <div class="col-cards" data-cards="${col.id}">
        ${col.cards.map(card => renderCard(card)).join('')}
      </div>
      <button class="add-card-btn" data-add-card="${col.id}"><i class="fa fa-plus"></i> Ajouter une carte</button>
    </div>
  `).join('') + `<button class="add-col-btn" id="addColBtn"><i class="fa fa-plus"></i> Ajouter une colonne</button>`

  bindEvents()
}

function renderCard(card) {
  return `
    <div class="kanban-card" draggable="true" data-card="${card.id}" data-col="${card.column_id}">
      <div class="card-title">${escHtml(card.title)}</div>
      ${card.notes ? `<div class="card-notes">${escHtml(card.notes).replace(/\n/g,'<br/>')}</div>` : ''}
      <div class="card-footer">
        <button data-edit-card="${card.id}" title="Modifier"><i class="fa fa-pen"></i> Éditer</button>
        <button class="del-btn" data-del-card="${card.id}" title="Supprimer"><i class="fa fa-trash"></i></button>
      </div>
    </div>
  `
}

// ── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Add column
  document.getElementById('addColBtn').addEventListener('click', async () => {
    const title = prompt('Nom de la colonne :')
    if (!title?.trim()) return
    try {
      const col = await api.post('/api/kanban/columns', { title: title.trim() })
      board.push({ ...col, cards: [] })
      render()
    } catch (e) { toast(e.message, 'error') }
  })

  // Rename column (blur)
  document.querySelectorAll('[data-col-title]').forEach(input => {
    input.addEventListener('blur', async () => {
      const colId = Number(input.dataset.colTitle)
      const title = input.value.trim()
      if (!title) return
      const col = board.find(c => c.id === colId)
      if (col && col.title !== title) {
        try { await api.put(`/api/kanban/columns/${colId}`, { title }); col.title = title }
        catch (e) { toast(e.message, 'error'); input.value = col.title }
      }
    })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur() })
  })

  // Delete column
  document.querySelectorAll('[data-del-col]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const colId = Number(btn.dataset.delCol)
      const col = board.find(c => c.id === colId)
      if (!confirm(`Supprimer la colonne « ${col.title} » et toutes ses cartes ?`)) return
      try {
        await api.delete(`/api/kanban/columns/${colId}`)
        board = board.filter(c => c.id !== colId)
        render()
      } catch (e) { toast(e.message, 'error') }
    })
  })

  // Add card
  document.querySelectorAll('[data-add-card]').forEach(btn => {
    btn.addEventListener('click', () => openModal({ mode: 'create', columnId: Number(btn.dataset.addCard) }))
  })

  // Edit card
  document.querySelectorAll('[data-edit-card]').forEach(btn => {
    btn.addEventListener('click', () => openModal({ mode: 'edit', cardId: Number(btn.dataset.editCard) }))
  })

  // Delete card
  document.querySelectorAll('[data-del-card]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cardId = Number(btn.dataset.delCard)
      try {
        await api.delete(`/api/kanban/cards/${cardId}`)
        board.forEach(col => { col.cards = col.cards.filter(c => c.id !== cardId) })
        render()
      } catch (e) { toast(e.message, 'error') }
    })
  })

  // Drag & drop
  document.querySelectorAll('[data-card]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragging = { cardId: Number(el.dataset.card), fromColId: Number(el.dataset.col) }
      el.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging')
      dragging = null
    })
  })

  document.querySelectorAll('[data-cards]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over') })
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'))
    zone.addEventListener('drop', async e => {
      e.preventDefault()
      zone.classList.remove('drag-over')
      if (!dragging) return
      const toColId = Number(zone.dataset.cards)
      const col = board.find(c => c.id === toColId)
      const fromCol = board.find(c => c.id === dragging.fromColId)
      const card = fromCol.cards.find(c => c.id === dragging.cardId)
      if (!card) return

      fromCol.cards = fromCol.cards.filter(c => c.id !== card.id)
      card.column_id = toColId
      col.cards.push(card)

      const updates = col.cards.map((c, i) => ({ id: c.id, column_id: toColId, position: i }))
      render()
      try { await api.put('/api/kanban/cards/reorder', updates) }
      catch (e) { toast(e.message, 'error'); load() }
    })
  })
}

// ── Modal ────────────────────────────────────────────────────────────────────

function openModal(ctx) {
  modalCtx = ctx
  const modal = document.getElementById('cardModal')
  document.getElementById('modalTitle').textContent = ctx.mode === 'create' ? 'Nouvelle carte' : 'Modifier la carte'
  document.getElementById('cardTitle').value = ''
  document.getElementById('cardNotes').value = ''

  if (ctx.mode === 'edit') {
    const card = board.flatMap(c => c.cards).find(c => c.id === ctx.cardId)
    if (card) {
      document.getElementById('cardTitle').value = card.title
      document.getElementById('cardNotes').value = card.notes
    }
  }

  modal.classList.add('open')
  document.getElementById('cardTitle').focus()
}

function closeModal() {
  document.getElementById('cardModal').classList.remove('open')
  modalCtx = null
}

document.getElementById('modalClose').addEventListener('click', closeModal)
document.getElementById('modalCancel').addEventListener('click', closeModal)
document.getElementById('cardModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal() })

document.getElementById('modalSave').addEventListener('click', async () => {
  const title = document.getElementById('cardTitle').value.trim()
  const notes = document.getElementById('cardNotes').value.trim()
  if (!title) { toast('Le titre est requis', 'error'); return }

  try {
    if (modalCtx.mode === 'create') {
      const card = await api.post('/api/kanban/cards', { column_id: modalCtx.columnId, title, notes })
      board.find(c => c.id === modalCtx.columnId).cards.push(card)
    } else {
      const updated = await api.put(`/api/kanban/cards/${modalCtx.cardId}`, { title, notes })
      board.forEach(col => {
        const i = col.cards.findIndex(c => c.id === modalCtx.cardId)
        if (i !== -1) col.cards[i] = updated
      })
    }
    toast(modalCtx.mode === 'create' ? 'Carte créée' : 'Carte mise à jour')
    closeModal()
    render()
  } catch (e) { toast(e.message, 'error') }
})

// Enter dans le titre déclenche la sauvegarde
document.getElementById('cardTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modalSave').click()
})

// ── Init ─────────────────────────────────────────────────────────────────────

async function load() {
  try {
    board = await api.get('/api/kanban')
    render()
  } catch {
    document.getElementById('kanbanBoard').innerHTML =
      '<div style="color:var(--danger);padding:20px"><i class="fa fa-triangle-exclamation"></i> Erreur de chargement</div>'
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api.post('/api/auth/logout')
  window.location.href = '/admin/login'
})

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

load()
