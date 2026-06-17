import './style.css'
import { Editor, Extension, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Markdown } from 'tiptap-markdown'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { DecorationSet, Decoration } from '@tiptap/pm/view'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
let currentPath = null
let allNotes    = []
let noteProps   = {}  // Record<string, string> — replaces tags

/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function toast(msg, type = 'success') {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--card-2);border:1px solid var(--line-2);border-radius:var(--radius);padding:10px 18px;font-size:13px;color:var(--fg);box-shadow:0 8px 24px rgba(0,0,0,.5);transform:translateY(60px);opacity:0;transition:all .22s;z-index:9999;pointer-events:none;'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.borderColor = type === 'success' ? 'rgba(45,212,191,.4)' : 'rgba(255,62,62,.4)'
  el.style.color = type === 'success' ? 'var(--green)' : 'var(--danger)'
  el.style.transform = 'translateY(0)'; el.style.opacity = '1'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.transform = 'translateY(60px)'; el.style.opacity = '0' }, 3000)
}

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('401') }
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}
async function apiPut(url, data) {
  const r = await fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('401') }
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}
async function apiDel(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(r.statusText)
  return r.json()
}

/* ════════════════════════════════════════════════
   RESIZABLE IMAGE NODE VIEW
════════════════════════════════════════════════ */
function buildResizableImageNodeView(node, editor, getPos) {
  const wrap = document.createElement('div')
  wrap.className = 'resizable-img-wrap'
  wrap.contentEditable = 'false'

  const img = document.createElement('img')
  img.src = node.attrs.src
  img.alt = node.attrs.alt || ''
  if (node.attrs.width) {
    img.style.width = node.attrs.width + 'px'
    if (node.attrs.height) img.style.height = node.attrs.height + 'px'
  }

  // Resize handles
  let ratio = null
  img.addEventListener('load', () => {
    if (img.naturalWidth && !ratio) ratio = img.naturalHeight / img.naturalWidth
  }, { once: true })

  const corners = ['nw', 'ne', 'sw', 'se']
  corners.forEach(c => {
    const h = document.createElement('div')
    h.className = `resize-handle ${c}`
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation()
      if (!ratio && img.naturalWidth) ratio = img.naturalHeight / img.naturalWidth
      const startX    = e.clientX
      const startW    = img.offsetWidth  || parseInt(node.attrs.width) || img.naturalWidth || 300
      const startH    = img.offsetHeight || parseInt(node.attrs.height) || (startW * (ratio || 0.66))
      const effectiveRatio = ratio || (startH / startW)
      const dir = c.includes('e') ? 1 : -1

      const onMove = ev => {
        const newW = Math.max(80, startW + (ev.clientX - startX) * dir)
        img.style.width = newW + 'px'
        img.style.height = Math.round(newW * effectiveRatio) + 'px'
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        const w = img.offsetWidth
        const h = img.offsetHeight
        const tr = editor.view.state.tr
        tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, width: w, height: h })
        editor.view.dispatch(tr)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
    wrap.appendChild(h)
  })

  wrap.appendChild(img)

  // Select on click
  wrap.addEventListener('click', e => {
    e.stopPropagation()
    document.querySelectorAll('.resizable-img-wrap.selected').forEach(el => el.classList.remove('selected'))
    wrap.classList.add('selected')
  })
  document.addEventListener('click', () => wrap.classList.remove('selected'), { passive: true })

  return {
    dom: wrap,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false
      img.src = updatedNode.attrs.src || img.src
      if (updatedNode.attrs.width) img.style.width = updatedNode.attrs.width + 'px'
      return true
    },
    selectNode() { wrap.classList.add('selected') },
    deselectNode() { wrap.classList.remove('selected') },
  }
}

/* ════════════════════════════════════════════════
   RESIZABLE IMAGE EXTENSION
════════════════════════════════════════════════ */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width:  { default: null, parseHTML: el => el.getAttribute('width')  || el.style.width?.replace('px','')  || null },
      height: { default: null, parseHTML: el => el.getAttribute('height') || el.style.height?.replace('px','') || null },
    }
  },
  addNodeView() {
    return ({ node, editor, getPos }) => buildResizableImageNodeView(node, editor, getPos)
  },
  addProseMirrorPlugins() {
    const getEditor = () => this.editor
    return [
      new Plugin({
        key: new PluginKey('docsImagePaste'),
        props: {
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items || [])
            const img = items.find(i => i.type.startsWith('image/'))
            if (!img) return false
            event.preventDefault()
            uploadDocImage(img.getAsFile()).then(url => {
              getEditor().chain().focus().setImage({ src: url }).run()
              toast('Image insérée')
            }).catch(() => toast('Erreur upload image', 'error'))
            return true
          },
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
            if (!files.length) return false
            event.preventDefault()
            files.forEach(f => uploadDocImage(f).then(url => {
              getEditor().chain().focus().setImage({ src: url }).run()
              toast('Image insérée')
            }).catch(() => toast('Erreur upload image', 'error')))
            return true
          }
        }
      })
    ]
  }
})

/* ════════════════════════════════════════════════
   WIKILINK DECORATION PLUGIN
════════════════════════════════════════════════ */
const WIKILINK_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g

const WikiLinkExtension = Extension.create({
  name: 'wikiLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLinks'),
        props: {
          decorations(state) {
            const { doc } = state
            const decos = []
            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              WIKILINK_RE.lastIndex = 0
              let m
              while ((m = WIKILINK_RE.exec(node.text)) !== null) {
                const title  = m[1].trim()
                const exists = allNotes.some(n =>
                  n.title.toLowerCase() === title.toLowerCase() || n.path === title || n.path.toLowerCase() === title.toLowerCase()
                )
                decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                  class: exists ? 'wiki-link-deco' : 'wiki-link-deco missing',
                  'data-target': title,
                  title: exists ? `→ ${title}` : `Note introuvable : ${title}`
                }))
              }
            })
            return DecorationSet.create(doc, decos)
          },
          handleClick(view, _pos, event) {
            const el = event.target.closest?.('.wiki-link-deco')
            if (!el) return false
            const target = el.dataset.target
            if (!target) return false
            const note = allNotes.find(n =>
              n.title.toLowerCase() === target.toLowerCase() || n.path === target || n.path.toLowerCase() === target.toLowerCase()
            )
            if (note) { loadNote(note.path); return true }
            toast(`Note introuvable : ${target}`, 'error')
            return true
          }
        }
      })
    ]
  }
})

/* ════════════════════════════════════════════════
   WIKILINK AUTOCOMPLETE DROPDOWN
════════════════════════════════════════════════ */
let wikiSuggestEl    = null
let wikiSuggestItems = []
let wikiSuggestIdx   = 0
let wikiSuggestFrom  = -1   // absolute doc position of the opening [[

function ensureWikiDropdown() {
  if (!wikiSuggestEl) {
    wikiSuggestEl = document.createElement('div')
    wikiSuggestEl.id = 'wikiSuggest'
    wikiSuggestEl.className = 'wiki-suggest'
    wikiSuggestEl.style.display = 'none'
    document.body.appendChild(wikiSuggestEl)
  }
  return wikiSuggestEl
}

function hideWikiSuggest() {
  if (wikiSuggestEl) wikiSuggestEl.style.display = 'none'
  wikiSuggestItems = []
  wikiSuggestIdx   = 0
  wikiSuggestFrom  = -1
}

function renderWikiSuggest() {
  const el = ensureWikiDropdown()
  el.innerHTML = ''
  wikiSuggestItems.forEach((note, i) => {
    const item = document.createElement('div')
    item.className = 'wiki-suggest-item' + (i === wikiSuggestIdx ? ' active' : '')
    item.innerHTML = `<i class="fa fa-file-lines"></i> ${escHtml(note.title)}`
    item.addEventListener('mousedown', e => {
      e.preventDefault()
      applyWikiSuggest(wikiSuggestItems[i])
    })
    el.appendChild(item)
  })
}

function showWikiSuggest(query, from) {
  const q = query.toLowerCase()
  const items = allNotes
    .filter(n => !q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
    .slice(0, 12)

  if (!items.length) { hideWikiSuggest(); return }

  wikiSuggestItems = items
  wikiSuggestFrom  = from
  if (wikiSuggestIdx >= items.length) wikiSuggestIdx = 0

  const el = ensureWikiDropdown()
  renderWikiSuggest()

  // Position below cursor
  const coords = editor.view.coordsAtPos(editor.state.selection.from)
  const scrollEl = document.querySelector('.editor-scroll')
  const scrollTop = scrollEl ? scrollEl.scrollTop : 0
  el.style.left    = Math.min(coords.left, window.innerWidth - 250) + 'px'
  el.style.top     = (coords.bottom + window.scrollY + 4) + 'px'
  el.style.display = 'block'
}

function applyWikiSuggest(note) {
  if (!note || wikiSuggestFrom < 0) return
  const to = editor.state.selection.from
  editor.view.dispatch(
    editor.state.tr.insertText(`[[${note.title}]]`, wikiSuggestFrom, to)
  )
  hideWikiSuggest()
  editor.commands.focus()
}

function checkWikiSuggest() {
  if (!editor) return
  const { state } = editor
  const { selection } = state
  if (!selection.empty) { hideWikiSuggest(); return }

  const pos      = selection.from
  const $pos     = state.doc.resolve(pos)
  const nodeStart = $pos.start()
  const textBefore = state.doc.textBetween(nodeStart, pos, null, '\0')

  const match = /\[\[([^\]\n]*)$/.exec(textBefore)
  if (!match) { hideWikiSuggest(); return }

  const query    = match[1]
  const localIdx = textBefore.lastIndexOf('[[')
  const from     = nodeStart + localIdx

  showWikiSuggest(query, from)
}

/* ════════════════════════════════════════════════
   UPLOAD
════════════════════════════════════════════════ */
async function uploadDocImage(file) {
  const fd = new FormData()
  fd.append('image', file)
  const r = await fetch('/api/docs/admin/upload', { method: 'POST', credentials: 'include', body: fd })
  if (!r.ok) throw new Error('Upload failed')
  const { url } = await r.json()
  return url
}

/* ════════════════════════════════════════════════
   TIPTAP EDITOR INIT
════════════════════════════════════════════════ */
let editor = null

function initEditor() {
  editor = new Editor({
    element: document.getElementById('docsEditor'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: '# Titre de la note\n\nCommencez à écrire…' }),
      CodeBlockLowlight.configure({ lowlight }),
      WikiLinkExtension,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'ProseMirror', spellcheck: 'false' },
      handleKeyDown(_view, event) {
        // WikiLink dropdown navigation
        if (!wikiSuggestEl || wikiSuggestEl.style.display === 'none' || !wikiSuggestItems.length) return false
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          wikiSuggestIdx = (wikiSuggestIdx + 1) % wikiSuggestItems.length
          renderWikiSuggest()
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          wikiSuggestIdx = (wikiSuggestIdx - 1 + wikiSuggestItems.length) % wikiSuggestItems.length
          renderWikiSuggest()
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          applyWikiSuggest(wikiSuggestItems[wikiSuggestIdx])
          return true
        }
        if (event.key === 'Escape') {
          hideWikiSuggest()
          return true
        }
        return false
      }
    },
    onUpdate: () => { updateToolbar(); checkWikiSuggest() },
    onSelectionUpdate: () => { updateToolbar(); checkWikiSuggest() },
  })
}

/* ════════════════════════════════════════════════
   TOOLBAR
════════════════════════════════════════════════ */
function updateToolbar() {
  if (!editor) return
  document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd
    const active =
      cmd === 'bold'         ? editor.isActive('bold') :
      cmd === 'italic'       ? editor.isActive('italic') :
      cmd === 'strike'       ? editor.isActive('strike') :
      cmd === 'code'         ? editor.isActive('code') :
      cmd === 'h1'           ? editor.isActive('heading', { level: 1 }) :
      cmd === 'h2'           ? editor.isActive('heading', { level: 2 }) :
      cmd === 'h3'           ? editor.isActive('heading', { level: 3 }) :
      cmd === 'bulletList'   ? editor.isActive('bulletList') :
      cmd === 'orderedList'  ? editor.isActive('orderedList') :
      cmd === 'blockquote'   ? editor.isActive('blockquote') :
      cmd === 'codeBlock'    ? editor.isActive('codeBlock') :
      cmd === 'link'         ? editor.isActive('link') : false
    btn.classList.toggle('active', active)
  })
}

document.getElementById('toolbar').addEventListener('mousedown', e => {
  const btn = e.target.closest('button[data-cmd]')
  if (!btn || !editor) return
  e.preventDefault()
  const cmd = btn.dataset.cmd
  const c = editor.chain().focus()
  if (cmd === 'bold')        c.toggleBold().run()
  else if (cmd === 'italic') c.toggleItalic().run()
  else if (cmd === 'strike') c.toggleStrike().run()
  else if (cmd === 'code')   c.toggleCode().run()
  else if (cmd === 'h1')     c.toggleHeading({ level: 1 }).run()
  else if (cmd === 'h2')     c.toggleHeading({ level: 2 }).run()
  else if (cmd === 'h3')     c.toggleHeading({ level: 3 }).run()
  else if (cmd === 'bulletList')  c.toggleBulletList().run()
  else if (cmd === 'orderedList') c.toggleOrderedList().run()
  else if (cmd === 'blockquote')  c.toggleBlockquote().run()
  else if (cmd === 'codeBlock')   c.toggleCodeBlock().run()
  else if (cmd === 'hr')          c.setHorizontalRule().run()
  else if (cmd === 'undo')        c.undo().run()
  else if (cmd === 'redo')        c.redo().run()
  else if (cmd === 'link') {
    const prev = editor.getAttributes('link').href || ''
    const url = prompt('URL du lien :', prev)
    if (url === null) return
    if (url === '') c.unsetLink().run()
    else c.setLink({ href: url }).run()
  }
  else if (cmd === 'image') document.getElementById('imageFileInput').click()
  else if (cmd === 'wikilink') {
    const sel = editor.state.selection
    const selectedText = editor.state.doc.textBetween(sel.from, sel.to)
    c.insertContent(`[[${selectedText || 'Note Title'}]]`).run()
  }
})

document.getElementById('imageFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  try {
    const url = await uploadDocImage(file)
    editor.chain().focus().setImage({ src: url }).run()
    toast('Image insérée')
  } catch { toast('Erreur upload image', 'error') }
  e.target.value = ''
})

/* ════════════════════════════════════════════════
   KEY / VALUE PROPERTIES
════════════════════════════════════════════════ */
function renderProperties() {
  const wrap = document.getElementById('propsRows')
  wrap.innerHTML = ''
  Object.entries(noteProps).forEach(([key, value]) => {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `
      <span class="prop-key-label" title="${escHtml(key)}">${escHtml(key)}</span>
      <span class="prop-colon">:</span>
      <input class="prop-val-edit" value="${escHtml(String(value))}" data-key="${escHtml(key)}"/>
      <button class="prop-del" title="Supprimer">×</button>
    `
    const valInput = row.querySelector('.prop-val-edit')
    valInput.addEventListener('input',  () => { noteProps[key] = valInput.value })
    valInput.addEventListener('change', () => { noteProps[key] = valInput.value })
    row.querySelector('.prop-del').addEventListener('click', () => {
      delete noteProps[key]
      renderProperties()
    })
    wrap.appendChild(row)
  })
}

function updatePropSuggestions(key) {
  const dl = document.getElementById('propValSuggestions')
  dl.innerHTML = ''
  if (!key) return
  const seen = new Set()
  allNotes.forEach(n => {
    if (!n.properties) return
    const v = n.properties[key]
    if (typeof v === 'string' && v && !seen.has(v)) { seen.add(v); const o = document.createElement('option'); o.value = v; dl.appendChild(o) }
  })
}

function addProp() {
  const key = document.getElementById('propKeyInput').value.trim()
  const val = document.getElementById('propValInput').value.trim()
  if (!key) { document.getElementById('propKeyInput').focus(); return }
  noteProps[key] = val
  document.getElementById('propKeyInput').value = ''
  document.getElementById('propValInput').value = ''
  document.getElementById('propValSuggestions').innerHTML = ''
  renderProperties()
}

document.getElementById('propKeyInput').addEventListener('input', function() {
  updatePropSuggestions(this.value.trim())
})
document.getElementById('propKeyInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('propValInput').focus() }
})
document.getElementById('propValInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addProp() }
})
document.getElementById('propAddBtn').addEventListener('click', addProp)

/* ════════════════════════════════════════════════
   FILE TREE
════════════════════════════════════════════════ */
function buildTree(notes) {
  const root = { _notes: [], _folders: {} }
  notes.forEach(note => {
    const parts = note.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const f = parts[i]
      if (!node._folders[f]) node._folders[f] = { _notes: [], _folders: {} }
      node = node._folders[f]
    }
    node._notes.push(note)
  })
  return root
}

function fmtFolder(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function renderTreeNode(node, prefix = '') {
  const ul = document.createElement('ul')
  ul.className = 'ft-ul'
  Object.entries(node._folders).sort(([a],[b]) => a.localeCompare(b)).forEach(([name, child]) => {
    const li = document.createElement('li')
    li.className = 'ft-folder open'
    const folderPath = prefix ? `${prefix}/${name}` : name
    const head = document.createElement('div')
    head.className = 'ft-folder-head'
    head.innerHTML = `
      <i class="fa fa-chevron-right"></i>
      <i class="fa fa-folder-open" style="font-size:11px;color:var(--fg-4)"></i>
      <span style="flex:1">${fmtFolder(name)}</span>
      <span class="folder-actions">
        <span class="add-btn add-note-btn" title="Nouvelle note dans ce dossier"><i class="fa fa-file-circle-plus"></i></span>
        <span class="add-btn add-folder-btn" title="Nouveau sous-dossier"><i class="fa fa-folder-plus"></i></span>
      </span>
    `
    head.querySelector('.add-note-btn').addEventListener('click', e => {
      e.stopPropagation()
      showNewNoteBar(folderPath + '/')
    })
    head.querySelector('.add-folder-btn').addEventListener('click', e => {
      e.stopPropagation()
      showInlineFolderInput(li, folderPath + '/')
    })
    head.addEventListener('click', e => { if (e.target.closest('.folder-actions')) return; li.classList.toggle('open') })
    li.appendChild(head)
    li.appendChild(renderTreeNode(child, folderPath))
    ul.appendChild(li)
  })
  node._notes.slice().sort((a,b) => a.title.localeCompare(b.title)).forEach(note => {
    const li = document.createElement('li')
    li.className = 'ft-note' + (note.path === currentPath ? ' active' : '') + (note.published ? '' : ' draft')
    li.dataset.path = note.path
    li.innerHTML = `<i class="fa fa-file-lines"></i><span>${note.title}</span><span class="del-btn" title="Supprimer"><i class="fa fa-trash"></i></span>`
    li.querySelector('.del-btn').addEventListener('click', e => { e.stopPropagation(); deleteNote(note.path) })
    li.addEventListener('click', e => { if (e.target.closest('.del-btn')) return; loadNote(note.path) })
    ul.appendChild(li)
  })
  return ul
}

function showInlineFolderInput(parentLi, prefix) {
  // Remove any pre-existing inline input
  parentLi.querySelectorAll('.ft-folder-inline').forEach(el => el.remove())
  parentLi.classList.add('open')

  const li = document.createElement('li')
  li.className = 'ft-folder-inline'
  const inp = document.createElement('input')
  inp.className = 'new-note-input'
  inp.placeholder = 'nom-du-dossier'
  li.appendChild(inp)

  const childUl = parentLi.querySelector('.ft-ul')
  if (childUl) childUl.insertBefore(li, childUl.firstChild)
  else parentLi.appendChild(li)

  inp.focus()

  const confirm = () => {
    const raw = inp.value.trim()
    li.remove()
    if (!raw) return
    const slug = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '')
    if (slug) showNewNoteBar(prefix + slug + '/')
  }
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm() }
    if (e.key === 'Escape') li.remove()
  })
  inp.addEventListener('blur', () => setTimeout(() => { li.remove() }, 200))
}

function refreshTree() {
  const container = document.getElementById('fileTree')
  container.innerHTML = ''
  if (!allNotes.length) { container.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--fg-4)">Aucune note.</div>'; return }
  container.appendChild(renderTreeNode(buildTree(allNotes)))
}

/* ════════════════════════════════════════════════
   NEW NOTE FORM
════════════════════════════════════════════════ */
function showNewNoteBar(prefix = '') {
  const bar   = document.getElementById('newNoteBar')
  const input = document.getElementById('newNotePath')
  bar.classList.add('show')
  input.value = prefix; input.focus()
  input.setSelectionRange(prefix.length, prefix.length)
}

document.getElementById('btnNewNote').addEventListener('click', () => showNewNoteBar())
document.getElementById('btnCancelNew').addEventListener('click', () => document.getElementById('newNoteBar').classList.remove('show'))
document.getElementById('btnCreate').addEventListener('click', createNote)
document.getElementById('newNotePath').addEventListener('keydown', e => {
  if (e.key === 'Enter') createNote()
  if (e.key === 'Escape') document.getElementById('newNoteBar').classList.remove('show')
})

function createNote() {
  const raw = document.getElementById('newNotePath').value.trim()
  let p = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '')
  if (!p) return

  // If path ends with / (created via folder button with no note name added), append 'index'
  if (p.endsWith('/')) p += 'index'

  document.getElementById('newNoteBar').classList.remove('show')
  currentPath = null
  const title = fmtFolder(p.split('/').pop())
  document.getElementById('notePath').value = p
  document.getElementById('noteTitle').value = title
  editor.commands.setContent(`# ${title}\n\n`)
  noteProps = {}; renderProperties()
  document.getElementById('publishedToggle').checked = true
  document.getElementById('propsMeta').textContent = ''
  document.getElementById('previewLink').href = '#'
  editor.commands.focus('end')
}

// No auto-slash on blur — too aggressive, caused accidental path mangling

/* ════════════════════════════════════════════════
   LOAD / SAVE / DELETE
════════════════════════════════════════════════ */
async function loadNote(p) {
  try {
    const note = await apiGet(`/api/docs/admin/note/${p}`)
    currentPath = p
    document.getElementById('notePath').value  = note.path
    document.getElementById('noteTitle').value = note.title
    editor.commands.setContent(note.content || '')
    // Migrate legacy tags array → noteProps.tags string
    const rawProps = note.properties || {}
    if (Array.isArray(rawProps.tags)) rawProps.tags = rawProps.tags.join(', ')
    noteProps = rawProps
    renderProperties()
    document.getElementById('publishedToggle').checked = !!note.published
    document.getElementById('previewLink').href = `/docs/${note.path}`
    const upd = note.updated_at ? new Date(note.updated_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' }) : ''
    document.getElementById('propsMeta').innerHTML = upd ? `Mis à jour le ${upd}<br/><code style="font-size:10px">${escHtml(note.path)}</code>` : ''
    refreshTree()
    editor.commands.focus()
  } catch { toast('Erreur chargement', 'error') }
}

async function saveNote() {
  const rawPath   = document.getElementById('notePath').value.trim()
  // Always strip leading/trailing slashes — avoids "dfir/registry/" accidents
  const path      = rawPath.replace(/^\/+|\/+$/g, '')
  document.getElementById('notePath').value = path
  const title     = document.getElementById('noteTitle').value.trim() || 'Untitled'
  const content   = editor.storage.markdown.getMarkdown()
  const published = document.getElementById('publishedToggle').checked

  if (!path) { toast('Chemin requis', 'error'); return }

  // If path changed → delete old
  if (currentPath && currentPath !== path) {
    await apiDel(`/api/docs/admin/note/${currentPath}`).catch(() => {})
  }

  try {
    await apiPut(`/api/docs/admin/note/${path}`, { title, content, properties: noteProps, published })
    currentPath = path
    toast(`✓ ${path} sauvegardé`)
    allNotes = await apiGet('/api/docs/admin/all')
    refreshTree()
  } catch { toast('Erreur sauvegarde', 'error') }
}

async function deleteNote(p) {
  if (!confirm(`Supprimer "${p}" ?`)) return
  try {
    await apiDel(`/api/docs/admin/note/${p}`)
    if (currentPath === p) {
      currentPath = null
      document.getElementById('notePath').value = ''
      document.getElementById('noteTitle').value = ''
      editor.commands.setContent('')
      noteProps = {}; renderProperties()
    }
    allNotes = await apiGet('/api/docs/admin/all')
    refreshTree()
    toast('Note supprimée')
  } catch { toast('Erreur suppression', 'error') }
}

/* ════════════════════════════════════════════════
   SAVE BUTTONS + Ctrl+S
════════════════════════════════════════════════ */
document.getElementById('saveBtn').addEventListener('click', saveNote)
document.getElementById('saveBtnProps').addEventListener('click', saveNote)
document.getElementById('deleteBtn').addEventListener('click', () => { if (currentPath) deleteNote(currentPath) })
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNote(); return }
  // Only intercept Alt shortcuts when focus is in the editor
  if (!editor || !editor.isFocused) return

  // Alt+& → inline code  (AZERTY: & = Digit1)
  if (e.altKey && e.key === '&') {
    e.preventDefault()
    const { state } = editor
    const { selection } = state
    if (!selection.empty) {
      // Wrap selection in backticks
      const text = state.doc.textBetween(selection.from, selection.to)
      const { tr } = state
      editor.view.dispatch(
        tr.replaceSelectionWith(state.schema.text('`' + text + '`'))
      )
    } else {
      // Insert `` and place cursor between
      const pos = selection.from
      const { tr } = state
      editor.view.dispatch(
        tr.insertText('``', pos).setSelection(TextSelection.create(tr.doc, pos + 1))
      )
    }
    return
  }

  // Alt+é → code block  (AZERTY: é = Digit2)
  if (e.altKey && e.key === 'é') {
    e.preventDefault()
    const { state } = editor
    const { selection } = state
    const $from      = state.doc.resolve(selection.from)
    const nodeStart  = $from.start()
    const nodeEnd    = $from.end()
    const lineText   = state.doc.textBetween(nodeStart, nodeEnd)

    if (lineText.trim().length > 0) {
      // Non-empty line → move to end of block, split, then set code block
      editor.chain().focus()
        .command(({ tr: t, dispatch }) => {
          if (dispatch) dispatch(t.setSelection(TextSelection.create(t.doc, nodeEnd)))
          return true
        })
        .splitBlock()
        .setCodeBlock()
        .run()
    } else {
      editor.chain().focus().setCodeBlock().run()
    }
    return
  }
})

/* ════════════════════════════════════════════════
   TEMPLATES — modal dédié
════════════════════════════════════════════════ */
let allTemplates  = []
let tplEditor     = null
let currentTplId  = null   // id du template sélectionné dans le modal, null = nouveau

/* ── Fetch ── */
async function fetchTemplates() {
  try { allTemplates = await apiGet('/api/docs/admin/templates') }
  catch { allTemplates = [] }
}

/* ── Second TipTap instance (lazy) ── */
function initTplEditor() {
  if (tplEditor) return
  tplEditor = new Editor({
    element: document.getElementById('tplEditorEl'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Contenu du template…' }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: '',
    editorProps: { attributes: { class: 'ProseMirror', spellcheck: 'false' } },
    onUpdate:        () => updateTplToolbar(),
    onSelectionUpdate: () => updateTplToolbar(),
  })
}

function updateTplToolbar() {
  if (!tplEditor) return
  document.querySelectorAll('#tplToolbar button[data-tcmd]').forEach(btn => {
    const cmd = btn.dataset.tcmd
    const active =
      cmd === 'bold'        ? tplEditor.isActive('bold') :
      cmd === 'italic'      ? tplEditor.isActive('italic') :
      cmd === 'strike'      ? tplEditor.isActive('strike') :
      cmd === 'code'        ? tplEditor.isActive('code') :
      cmd === 'h1'          ? tplEditor.isActive('heading', { level: 1 }) :
      cmd === 'h2'          ? tplEditor.isActive('heading', { level: 2 }) :
      cmd === 'h3'          ? tplEditor.isActive('heading', { level: 3 }) :
      cmd === 'bulletList'  ? tplEditor.isActive('bulletList') :
      cmd === 'orderedList' ? tplEditor.isActive('orderedList') :
      cmd === 'blockquote'  ? tplEditor.isActive('blockquote') :
      cmd === 'codeBlock'   ? tplEditor.isActive('codeBlock') : false
    btn.classList.toggle('active', active)
  })
}

document.getElementById('tplToolbar').addEventListener('mousedown', e => {
  const btn = e.target.closest('button[data-tcmd]')
  if (!btn || !tplEditor) return
  e.preventDefault()
  const cmd = btn.dataset.tcmd
  const c = tplEditor.chain().focus()
  if (cmd === 'bold')           c.toggleBold().run()
  else if (cmd === 'italic')    c.toggleItalic().run()
  else if (cmd === 'strike')    c.toggleStrike().run()
  else if (cmd === 'code')      c.toggleCode().run()
  else if (cmd === 'h1')        c.toggleHeading({ level: 1 }).run()
  else if (cmd === 'h2')        c.toggleHeading({ level: 2 }).run()
  else if (cmd === 'h3')        c.toggleHeading({ level: 3 }).run()
  else if (cmd === 'bulletList')   c.toggleBulletList().run()
  else if (cmd === 'orderedList')  c.toggleOrderedList().run()
  else if (cmd === 'blockquote')   c.toggleBlockquote().run()
  else if (cmd === 'codeBlock')    c.toggleCodeBlock().run()
  else if (cmd === 'hr')           c.setHorizontalRule().run()
  else if (cmd === 'undo')         c.undo().run()
  else if (cmd === 'redo')         c.redo().run()
})

/* ── Modal open / close ── */
function openTplModal() {
  document.getElementById('tplModalOverlay').classList.add('open')
  initTplEditor()
  renderTplModalList()
  if (allTemplates.length) selectTpl(allTemplates[0])
  else newTpl()
}

function closeTplModal() {
  document.getElementById('tplModalOverlay').classList.remove('open')
}

document.getElementById('openTplModal').addEventListener('click', openTplModal)
document.getElementById('tplModalClose').addEventListener('click', closeTplModal)
document.getElementById('tplModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('tplModalOverlay')) closeTplModal()
})
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('tplModalOverlay').classList.contains('open')) {
    closeTplModal()
  }
})

/* ── List rendering ── */
function renderTplModalList() {
  const list = document.getElementById('tplModalList')
  list.innerHTML = ''
  if (!allTemplates.length) {
    list.innerHTML = '<div class="tpl-list-empty">Aucun template.<br/>Cliquez + pour créer.</div>'
    return
  }
  allTemplates.forEach(tpl => {
    const item = document.createElement('div')
    item.className = 'tpl-list-item' + (tpl.id === currentTplId ? ' active' : '')
    item.dataset.id = tpl.id
    item.innerHTML = `<i class="fa fa-file-code"></i><span title="${escHtml(tpl.name)}">${escHtml(tpl.name)}</span>`
    item.addEventListener('click', () => selectTpl(tpl))
    list.appendChild(item)
  })
}

/* ── Select / New ── */
function selectTpl(tpl) {
  currentTplId = tpl.id
  document.getElementById('tplModalName').value = tpl.name
  tplEditor.commands.setContent(tpl.content || '')
  renderTplModalList()
}

function newTpl() {
  currentTplId = null
  document.getElementById('tplModalName').value = ''
  tplEditor?.commands.setContent('')
  renderTplModalList()
  document.getElementById('tplModalName').focus()
}

document.getElementById('tplNewBtn').addEventListener('click', newTpl)

/* ── "From note" : crée un template depuis la note active ── */
document.getElementById('tplFromNoteBtn').addEventListener('click', () => {
  if (!editor) return
  currentTplId = null
  const content = editor.storage.markdown.getMarkdown()
  const suggestedName = document.getElementById('noteTitle').value.trim() || ''
  document.getElementById('tplModalName').value = suggestedName
  tplEditor.commands.setContent(content)
  renderTplModalList()
  document.getElementById('tplModalName').focus()
  document.getElementById('tplModalName').select()
})

/* ── Save ── */
document.getElementById('tplModalSave').addEventListener('click', async () => {
  const name = document.getElementById('tplModalName').value.trim()
  if (!name) { document.getElementById('tplModalName').focus(); toast('Donnez un nom au template', 'error'); return }

  // Detect name conflict (different id)
  const conflict = allTemplates.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== currentTplId)
  if (conflict && !confirm(`Un template "${name}" existe déjà. Le remplacer ?`)) return

  const content = tplEditor.storage.markdown.getMarkdown()
  const saveName = currentTplId
    ? allTemplates.find(t => t.id === currentTplId)?.name ?? name  // keep original name on update unless renamed
    : name

  try {
    const saved = await fetch('/api/docs/admin/templates', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, tags: {} })
    }).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })

    currentTplId = saved.id
    await fetchTemplates()
    renderTplModalList()
    toast(`Template "${name}" sauvegardé`)
  } catch { toast('Erreur sauvegarde template', 'error') }
})

/* ── Apply to current note ── */
document.getElementById('tplModalApply').addEventListener('click', () => {
  if (!editor || !tplEditor) return
  const content = tplEditor.storage.markdown.getMarkdown()
  if (!content.trim()) { toast('Template vide', 'error'); return }
  if (!confirm('Appliquer ce template ? Le contenu de la note sera remplacé.')) return
  editor.commands.setContent(content)
  toast('Template appliqué')
  closeTplModal()
  editor.commands.focus()
})

/* ── Delete ── */
document.getElementById('tplModalDelete').addEventListener('click', async () => {
  if (!currentTplId) { toast('Aucun template sélectionné', 'error'); return }
  const tpl = allTemplates.find(t => t.id === currentTplId)
  if (!confirm(`Supprimer le template "${tpl?.name}" ?`)) return
  try {
    await apiDel(`/api/docs/admin/templates/${currentTplId}`)
    toast('Template supprimé')
    await fetchTemplates()
    currentTplId = null
    renderTplModalList()
    if (allTemplates.length) selectTpl(allTemplates[0])
    else newTpl()
  } catch { toast('Erreur suppression template', 'error') }
})

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
async function init() {
  initEditor()
  renderProperties()
  fetchTemplates()   // preload, tplEditor lazy-init on first modal open
  try {
    allNotes = await apiGet('/api/docs/admin/all')
    refreshTree()
  } catch (e) {
    if (e.message !== '401') toast('Erreur chargement des notes', 'error')
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  location.href = '/admin/login'
})

init()
