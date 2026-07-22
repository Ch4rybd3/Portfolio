/* ════════════════════════════════════════════════
   TABLE HOVER CONTROLS
   Two small "+" affordances, shown only while hovering near a table's right
   or bottom edge, to add a column/row without opening the right-click menu
   (table-context-menu.js) — plus intercepting Enter in the table's last row
   to append a new row instead of just splitting the paragraph inside the
   cell (spreadsheet-like "Enter grows the table" behavior).
════════════════════════════════════════════════ */

// Enter pressed while the selection is anywhere in the table's last row →
// add a row after it instead of the default split-block behavior. Returns
// true if it handled the key (caller should preventDefault).
export function handleTableEnter(editor) {
  const { state } = editor
  const { selection } = state
  if (!selection.empty) return false
  const { $from } = selection

  let tableDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') { tableDepth = d; break }
  }
  if (tableDepth === -1 || tableDepth === $from.depth) return false

  const table = $from.node(tableDepth)
  const rowIndex = $from.index(tableDepth)
  if (rowIndex !== table.childCount - 1) return false

  editor.chain().focus().addRowAfter().run()
  return true
}

export function initTableHoverControls(editor, editorRootEl) {
  const EDGE = 14

  const makeBtn = extraClass => {
    const btn = document.createElement('div')
    btn.className = `table-hover-btn ${extraClass}`
    btn.innerHTML = '<i class="fa fa-plus"></i>'
    btn.style.display = 'none'
    document.body.appendChild(btn)
    return btn
  }
  const colBtn = makeBtn('table-hover-btn-col')
  const rowBtn = makeBtn('table-hover-btn-row')

  let activeTable = null

  function hideBtns() {
    colBtn.style.display = 'none'
    rowBtn.style.display = 'none'
    activeTable = null
  }

  editorRootEl.addEventListener('mousemove', e => {
    const table = e.target.closest?.('table')
    if (!table || !editorRootEl.contains(table)) { hideBtns(); return }
    activeTable = table
    const rect = table.getBoundingClientRect()

    const nearRight  = e.clientX <= rect.right + 4 && rect.right - e.clientX <= EDGE
    const nearBottom = e.clientY <= rect.bottom + 4 && rect.bottom - e.clientY <= EDGE

    if (nearRight) {
      colBtn.style.left = (rect.right - 10) + 'px'
      colBtn.style.top  = (rect.top + rect.height / 2 - 10) + 'px'
      colBtn.style.display = 'flex'
    } else colBtn.style.display = 'none'

    if (nearBottom) {
      rowBtn.style.left = (rect.left + rect.width / 2 - 10) + 'px'
      rowBtn.style.top  = (rect.bottom - 10) + 'px'
      rowBtn.style.display = 'flex'
    } else rowBtn.style.display = 'none'
  })
  editorRootEl.addEventListener('mouseleave', hideBtns)

  colBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    if (!activeTable) return
    const firstRow = activeTable.rows[0]
    const cell = firstRow?.cells[firstRow.cells.length - 1]
    if (!cell) return
    const pos = editor.view.posAtDOM(cell, 0)
    editor.chain().focus().setTextSelection(pos).addColumnAfter().run()
  })
  rowBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    if (!activeTable) return
    const lastRow = activeTable.rows[activeTable.rows.length - 1]
    const cell = lastRow?.cells[0]
    if (!cell) return
    const pos = editor.view.posAtDOM(cell, 0)
    editor.chain().focus().setTextSelection(pos).addRowAfter().run()
  })
}
