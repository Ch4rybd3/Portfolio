/* ════════════════════════════════════════════════
   EXCALIDRAW DIAGRAM — atomic TipTap node
   Stored in markdown as a fenced ```excalidraw block containing JSON with:
   - sceneUrl : URL of the uploaded editable scene (elements/appState/files)
   - svg      : pre-rendered static SVG string, shown directly in both the
                admin NodeView and the public read-only page — no Excalidraw
                JS needed at all to just *display* a diagram.
   Round-trips through markdown the same way code blocks already do in this
   editor: markdown-it's stock fence renderer emits
   `<pre><code class="language-excalidraw">…</code></pre>`, which parseHTML
   below picks up (Markdown.configure({html:true}) is already active), and
   the markdown storage spec below writes it back out as a fence on save.
════════════════════════════════════════════════ */
import { Node } from '@tiptap/core'

function buildExcalidrawNodeView(node, editor, getPos, onEdit) {
  const wrap = document.createElement('div')
  wrap.className = 'excalidraw-node-wrap'
  wrap.contentEditable = 'false'

  const svgHolder = document.createElement('div')
  svgHolder.className = 'excalidraw-node-svg'
  svgHolder.innerHTML = node.attrs.svg || ''
  wrap.appendChild(svgHolder)

  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'excalidraw-node-edit-btn'
  editBtn.title = 'Edit diagram'
  editBtn.innerHTML = '<i class="fa fa-pen-to-square"></i> Edit'
  editBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    e.stopPropagation()
    onEdit({ sceneUrl: node.attrs.sceneUrl, svg: node.attrs.svg }, ({ sceneUrl, svg }) => {
      if (typeof getPos !== 'function') return
      const tr = editor.view.state.tr
      tr.setNodeMarkup(getPos(), undefined, { sceneUrl, svg })
      editor.view.dispatch(tr)
    })
  })
  wrap.appendChild(editBtn)

  const delBtn = document.createElement('button')
  delBtn.type = 'button'
  delBtn.className = 'excalidraw-node-del-btn'
  delBtn.title = 'Delete diagram'
  delBtn.innerHTML = '<i class="fa fa-trash"></i>'
  delBtn.addEventListener('mousedown', e => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof getPos !== 'function') return
    const pos = getPos()
    editor.view.dispatch(editor.view.state.tr.delete(pos, pos + node.nodeSize))
  })
  wrap.appendChild(delBtn)

  wrap.addEventListener('click', e => {
    e.stopPropagation()
    document.querySelectorAll('.excalidraw-node-wrap.selected').forEach(el => el.classList.remove('selected'))
    wrap.classList.add('selected')
  })
  document.addEventListener('click', () => wrap.classList.remove('selected'), { passive: true })

  return {
    dom: wrap,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false
      svgHolder.innerHTML = updatedNode.attrs.svg || ''
      return true
    },
    selectNode() { wrap.classList.add('selected') },
    deselectNode() { wrap.classList.remove('selected') },
  }
}

export function createExcalidrawExtension(onEdit) {
  return Node.create({
    name: 'excalidrawDiagram',
    group: 'block',
    atom: true,
    addAttributes() {
      return {
        sceneUrl: { default: null },
        svg: { default: '' },
      }
    },
    parseHTML() {
      // Target the outer <pre> (like CodeBlockLowlight's own rule does) rather
      // than the inner <code>: matching on <code> alone loses the tie-break to
      // StarterKit's plain `code` mark rule (same default priority, registered
      // first), which otherwise grabs the element and turns the whole fence
      // into inline code text instead of this node. Higher priority also wins
      // the tie against CodeBlockLowlight's own unconditional `pre` rule.
      return [{
        tag: 'pre',
        preserveWhitespace: 'full',
        priority: 100,
        getAttrs: el => {
          const code = el.querySelector('code.language-excalidraw')
          if (!code) return false
          try {
            const { sceneUrl, svg } = JSON.parse(code.textContent || '{}')
            return { sceneUrl: sceneUrl || null, svg: svg || '' }
          } catch {
            return false
          }
        },
      }]
    },
    renderHTML({ node }) {
      return ['pre', ['code', { class: 'language-excalidraw' }, JSON.stringify({ sceneUrl: node.attrs.sceneUrl, svg: node.attrs.svg })]]
    },
    addNodeView() {
      return ({ node, editor, getPos }) => buildExcalidrawNodeView(node, editor, getPos, onEdit)
    },
    addStorage() {
      return {
        markdown: {
          serialize(state, node) {
            state.write('```excalidraw\n')
            state.text(JSON.stringify({ sceneUrl: node.attrs.sceneUrl, svg: node.attrs.svg }), false)
            state.ensureNewLine()
            state.write('```')
            state.closeBlock(node)
          },
          parse: {
            // Handled by markdown-it's stock fence rule + parseHTML above.
          },
        },
      }
    },
  })
}
