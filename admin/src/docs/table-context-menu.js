/* ════════════════════════════════════════════════
   TABLE RIGHT-CLICK CONTEXT MENU
   Right-clicking inside a table cell shows a small menu with the usual
   row/column/table edit actions — all backed by TipTap's built-in table
   commands, nothing custom to maintain.
════════════════════════════════════════════════ */
export function initTableContextMenu(editor, editorRootEl) {
  let menuEl = null

  function ensureMenu() {
    if (!menuEl) {
      menuEl = document.createElement('div')
      menuEl.className = 'table-ctx-menu'
      document.body.appendChild(menuEl)
    }
    return menuEl
  }

  function hide() {
    if (menuEl) menuEl.style.display = 'none'
  }

  function addItem(el, label, action, { danger = false } = {}) {
    const item = document.createElement('div')
    item.className = 'table-ctx-item' + (danger ? ' danger' : '')
    item.textContent = label
    item.addEventListener('mousedown', e => {
      e.preventDefault()
      action()
      hide()
    })
    el.appendChild(item)
  }

  function addSep(el) {
    el.appendChild(Object.assign(document.createElement('div'), { className: 'table-ctx-sep' }))
  }

  editorRootEl.addEventListener('contextmenu', e => {
    const cell = e.target.closest('td, th')
    if (!cell || !editor.isActive('table')) return
    e.preventDefault()

    const c = () => editor.chain().focus()
    const el = ensureMenu()
    el.innerHTML = ''

    addItem(el, 'Add row above',    () => c().addRowBefore().run())
    addItem(el, 'Add row below',    () => c().addRowAfter().run())
    addItem(el, 'Delete row',       () => c().deleteRow().run(), { danger: true })
    addSep(el)
    addItem(el, 'Add column left',  () => c().addColumnBefore().run())
    addItem(el, 'Add column right', () => c().addColumnAfter().run())
    addItem(el, 'Delete column',    () => c().deleteColumn().run(), { danger: true })
    addSep(el)
    addItem(el, 'Toggle header row', () => c().toggleHeaderRow().run())
    addItem(el, 'Toggle header column', () => c().toggleHeaderColumn().run())
    addSep(el)
    addItem(el, 'Delete table', () => c().deleteTable().run(), { danger: true })

    const menuW = 190
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
    el.style.left = x + 'px'
    el.style.top = e.clientY + 'px'
    el.style.display = 'block'
  })

  document.addEventListener('mousedown', e => {
    if (menuEl && menuEl.style.display !== 'none' && !menuEl.contains(e.target)) hide()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hide()
  })
  window.addEventListener('scroll', hide, true)
}
