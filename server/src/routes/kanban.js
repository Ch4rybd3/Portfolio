const express = require('express')
const db = require('../db')

const router = express.Router()

router.get('/', (req, res) => {
  const columns = db.prepare('SELECT * FROM kanban_columns ORDER BY position').all()
  const cards = db.prepare('SELECT * FROM kanban_cards ORDER BY position').all()
  res.json(columns.map(col => ({ ...col, cards: cards.filter(c => c.column_id === col.id) })))
})

router.post('/columns', (req, res) => {
  const { title } = req.body
  if (!title) return res.status(400).json({ error: 'Titre requis' })
  const maxPos = db.prepare('SELECT MAX(position) as m FROM kanban_columns').get().m ?? -1
  const r = db.prepare('INSERT INTO kanban_columns (title, position) VALUES (?, ?)').run(title, maxPos + 1)
  res.status(201).json(db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/columns/:id', (req, res) => {
  const { title } = req.body
  db.prepare('UPDATE kanban_columns SET title = ? WHERE id = ?').run(title, req.params.id)
  res.json(db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(req.params.id))
})

router.delete('/columns/:id', (req, res) => {
  db.prepare('DELETE FROM kanban_columns WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

router.post('/cards', (req, res) => {
  const { column_id, title, notes } = req.body
  if (!column_id || !title) return res.status(400).json({ error: 'Champs requis' })
  const maxPos = db.prepare('SELECT MAX(position) as m FROM kanban_cards WHERE column_id = ?').get(column_id).m ?? -1
  const r = db.prepare(
    'INSERT INTO kanban_cards (column_id, title, notes, position) VALUES (?, ?, ?, ?)'
  ).run(column_id, title, notes || '', maxPos + 1)
  res.status(201).json(db.prepare('SELECT * FROM kanban_cards WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/cards/reorder', (req, res) => {
  // [{ id, column_id, position }]
  const update = db.prepare('UPDATE kanban_cards SET column_id=?, position=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
  const tx = db.transaction((items) => items.forEach(({ id, column_id, position }) => update.run(column_id, position, id)))
  tx(req.body)
  res.json({ ok: true })
})

router.put('/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM kanban_cards WHERE id = ?').get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Carte introuvable' })
  const { title, notes, column_id, position } = req.body
  db.prepare(
    `UPDATE kanban_cards SET title=?, notes=?, column_id=?, position=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(title ?? card.title, notes ?? card.notes, column_id ?? card.column_id, position ?? card.position, req.params.id)
  res.json(db.prepare('SELECT * FROM kanban_cards WHERE id = ?').get(req.params.id))
})

router.delete('/cards/:id', (req, res) => {
  db.prepare('DELETE FROM kanban_cards WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
