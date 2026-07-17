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
   SECTION  (set by the HTML page before module load)
════════════════════════════════════════════════ */
const SECTION = window.DOCS_SECTION || 'kb'
const PUBLIC_BASE = SECTION === 'remora' ? '/remora' : '/docs'

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
let currentPath = null
let allNotes    = []
let noteProps   = {}  // Record<string, string> — replaces tags
let treeFilterQuery = ''

/* ── Persisted tree state (localStorage, per section) ── */
const LS_EMPTY_FOLDERS = `docsEmptyFolders:${window.DOCS_SECTION || 'kb'}`
const LS_FOLDER_OPEN   = `docsFolderOpen:${window.DOCS_SECTION || 'kb'}`

function lsLoad(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
let emptyFolders = new Set(lsLoad(LS_EMPTY_FOLDERS, []))   // dossiers sans note (virtuels)
let folderOpen   = lsLoad(LS_FOLDER_OPEN, {})              // path → bool (défaut : ouvert)

function saveEmptyFolders() { localStorage.setItem(LS_EMPTY_FOLDERS, JSON.stringify([...emptyFolders])) }
function saveFolderOpen()   { localStorage.setItem(LS_FOLDER_OPEN, JSON.stringify(folderOpen)) }
function isFolderOpen(path) { return folderOpen[path] !== false }

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
  if (!r.ok) {
    const msg = await r.json().then(j => j.error).catch(() => null)
    throw new Error(msg || r.statusText)
  }
  return r.json()
}

/* ── Visibilité publique (propriété `public` : absente = public) ── */
function isPublicProps(props) {
  const v = props?.public
  return v === undefined || v === null || v === '' || (v !== false && v !== 'false' && v !== 0)
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
              toast('Image inserted')
            }).catch(() => toast('Image upload failed', 'error'))
            return true
          },
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
            if (!files.length) return false
            event.preventDefault()
            files.forEach(f => uploadDocImage(f).then(url => {
              getEditor().chain().focus().setImage({ src: url }).run()
              toast('Image inserted')
            }).catch(() => toast('Image upload failed', 'error')))
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
                  title: exists ? `→ ${title}` : `Note not found: ${title}`
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
            openWikiCreateModal(target)
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
      Placeholder.configure({ placeholder: '# Note title\n\nStart writing…' }),
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
    onUpdate: () => { updateToolbar(); checkWikiSuggest(); scheduleAutosave() },
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
    const url = prompt('Link URL:', prev)
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
    toast('Image inserted')
  } catch { toast('Image upload failed', 'error') }
  e.target.value = ''
})

/* ════════════════════════════════════════════════
   KEY / VALUE PROPERTIES
════════════════════════════════════════════════ */
// Propriétés gérées par le serveur (injectées à la sauvegarde) : lecture seule
const AUTO_PROPS = ['created', 'updated', 'creator']

function renderProperties() {
  const wrap = document.getElementById('propsRows')
  wrap.innerHTML = ''
  // La propriété `public` est pilotée par le toggle dédié, pas par les lignes clé:valeur
  document.getElementById('publicToggle').checked = isPublicProps(noteProps)
  AUTO_PROPS.filter(k => noteProps[k] !== undefined && noteProps[k] !== '').forEach(key => {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `
      <span class="prop-key-label" title="${escHtml(key)}">${escHtml(key)}</span>
      <span class="prop-colon">:</span>
      <input class="prop-val-edit" value="${escHtml(String(noteProps[key]))}" readonly tabindex="-1" style="opacity:.6;cursor:default" title="Managed automatically"/>
    `
    wrap.appendChild(row)
  })
  Object.entries(noteProps).filter(([key]) => key !== 'public' && !AUTO_PROPS.includes(key)).forEach(([key, value]) => {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `
      <span class="prop-key-label" title="${escHtml(key)}">${escHtml(key)}</span>
      <span class="prop-colon">:</span>
      <input class="prop-val-edit" value="${escHtml(String(value))}" data-key="${escHtml(key)}"/>
      <button class="prop-del" title="Delete">×</button>
    `
    const valInput = row.querySelector('.prop-val-edit')
    valInput.addEventListener('input',  () => { noteProps[key] = valInput.value; scheduleAutosave() })
    valInput.addEventListener('change', () => { noteProps[key] = valInput.value })
    row.querySelector('.prop-del').addEventListener('click', () => {
      delete noteProps[key]
      renderProperties()
      scheduleAutosave()
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

document.getElementById('publicToggle').addEventListener('change', function() {
  noteProps.public = this.checked
  scheduleAutosave()
})

function addProp() {
  const key = document.getElementById('propKeyInput').value.trim()
  const val = document.getElementById('propValInput').value.trim()
  if (!key) { document.getElementById('propKeyInput').focus(); return }
  if (AUTO_PROPS.includes(key)) { toast(`"${key}" is managed automatically`, 'error'); return }
  noteProps[key] = val
  document.getElementById('propKeyInput').value = ''
  document.getElementById('propValInput').value = ''
  document.getElementById('propValSuggestions').innerHTML = ''
  renderProperties()
  scheduleAutosave()
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
  const ensureFolder = (folderPath) => {
    let node = root
    folderPath.split('/').forEach(f => {
      if (!node._folders[f]) node._folders[f] = { _notes: [], _folders: {} }
      node = node._folders[f]
    })
    return node
  }
  notes.forEach(note => {
    const parts = note.path.split('/')
    const node = parts.length > 1 ? ensureFolder(parts.slice(0, -1).join('/')) : root
    node._notes.push(note)
  })
  // Dossiers vides (créés mais sans note) — masqués quand un filtre est actif
  if (!treeFilterQuery) emptyFolders.forEach(f => ensureFolder(f))
  return root
}

/* ── Filtre : texte libre et/ou tokens clé:valeur ── */
function noteMatchesFilter(note, tokens) {
  return tokens.every(t => {
    const ci = t.indexOf(':')
    if (ci > 0) {
      const k = t.slice(0, ci), v = t.slice(ci + 1)
      const pv = note.properties?.[k]
      if (pv === undefined || pv === null) return false
      return v === '' || String(pv).toLowerCase().includes(v)
    }
    return note.title.toLowerCase().includes(t) || note.path.toLowerCase().includes(t)
  })
}

function filteredNotes() {
  if (!treeFilterQuery) return allNotes
  const tokens = treeFilterQuery.toLowerCase().split(/\s+/).filter(Boolean)
  return allNotes.filter(n => noteMatchesFilter(n, tokens))
}

/* ── Déplacement (rename / drag & drop) ── */
async function moveNote(oldPath, newPath) {
  try {
    const r = await fetch(`/api/docs/admin/move/${oldPath}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath })
    })
    if (r.status === 401) { location.href = '/admin/login'; return false }
    if (r.status === 409) { toast('A note already exists at this path', 'error'); return false }
    if (!r.ok) {
      const msg = await r.json().then(j => j.error).catch(() => null)
      toast(msg || 'Move failed', 'error')
      return false
    }
    if (currentPath === oldPath) {
      currentPath = newPath
      document.getElementById('notePath').value = newPath
      document.getElementById('propsPathInput').value = newPath
      document.getElementById('previewLink').href = `${PUBLIC_BASE}/${newPath}`
    }
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
    toast(`✓ Moved → ${newPath}`)
    return true
  } catch { toast('Move failed', 'error'); return false }
}

/* ── Renommage de dossier : réécrit le préfixe de toutes les notes qu'il contient ── */
async function moveFolder(oldPath, newPath) {
  try {
    const r = await fetch('/api/docs/admin/move-folder', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath, section: SECTION })
    })
    if (r.status === 401) { location.href = '/admin/login'; return false }
    if (!r.ok) {
      const msg = await r.json().then(j => j.error).catch(() => null)
      toast(msg || 'Folder rename failed', 'error')
      return false
    }
    // Transfère l'état local (dossiers vides, plis, note ouverte) vers le nouveau préfixe
    const remap = p => p === oldPath ? newPath : (p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p)
    emptyFolders = new Set([...emptyFolders].map(remap))
    saveEmptyFolders()
    folderOpen = Object.fromEntries(Object.entries(folderOpen).map(([p, v]) => [remap(p), v]))
    saveFolderOpen()
    if (currentPath && currentPath.startsWith(oldPath + '/')) {
      currentPath = remap(currentPath)
      document.getElementById('notePath').value = currentPath
      document.getElementById('propsPathInput').value = currentPath
      document.getElementById('previewLink').href = `${PUBLIC_BASE}/${currentPath}`
    }
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
    toast(`✓ Folder renamed → ${newPath}`)
    return true
  } catch { toast('Folder rename failed', 'error'); return false }
}

function startFolderRename(head, folderPath) {
  if (head.querySelector('.folder-rename-input')) return
  const nameSpan = head.querySelector('.ft-folder-name')
  const seg = folderPath.split('/').pop()
  const inp = document.createElement('input')
  inp.className = 'new-note-input folder-rename-input'
  inp.value = seg
  inp.style.flex = '1'
  inp.style.minWidth = '0'
  nameSpan.replaceWith(inp)
  inp.focus(); inp.select()

  let done = false
  const cancel = () => { if (done) return; done = true; inp.replaceWith(nameSpan) }
  const confirm = () => {
    if (done) return
    const slug = inp.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '')
    if (!slug || slug === seg) { cancel(); return }
    done = true
    const parent = folderPath.includes('/') ? folderPath.slice(0, folderPath.lastIndexOf('/') + 1) : ''
    moveFolder(folderPath, parent + slug)
  }
  inp.addEventListener('click', e => e.stopPropagation())
  inp.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter')  { e.preventDefault(); confirm() }
    if (e.key === 'Escape') cancel()
  })
  inp.addEventListener('blur', () => setTimeout(cancel, 200))
}

function makeNoteDraggable(li, note) {
  li.draggable = true
  li.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/note-path', note.path)
    e.dataTransfer.effectAllowed = 'move'
    li.classList.add('dragging')
  })
  li.addEventListener('dragend', () => li.classList.remove('dragging'))
}

function makeDropTarget(el, folderPath) {  // folderPath '' = racine
  el.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('text/note-path')) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    el.classList.add('drag-over')
  })
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation()
    el.classList.remove('drag-over')
    const oldPath = e.dataTransfer.getData('text/note-path')
    if (!oldPath) return
    const name = oldPath.split('/').pop()
    const newPath = folderPath ? `${folderPath}/${name}` : name
    if (newPath !== oldPath) moveNote(oldPath, newPath)
  })
}

function fmtFolder(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function renderTreeNode(node, prefix = '') {
  const ul = document.createElement('ul')
  ul.className = 'ft-ul'
  Object.entries(node._folders).sort(([a],[b]) => a.localeCompare(b)).forEach(([name, child]) => {
    const li = document.createElement('li')
    const folderPath = prefix ? `${prefix}/${name}` : name
    // Filtre actif → tout ouvert pour montrer les résultats
    const open = treeFilterQuery ? true : isFolderOpen(folderPath)
    li.className = 'ft-folder' + (open ? ' open' : '')
    const head = document.createElement('div')
    head.className = 'ft-folder-head'
    head.innerHTML = `
      <i class="fa fa-chevron-right"></i>
      <i class="fa fa-folder-open" style="font-size:11px;color:var(--fg-4)"></i>
      <span class="ft-folder-name" style="flex:1">${fmtFolder(name)}</span>
      <span class="folder-actions">
        <span class="add-btn add-note-btn" title="New note in this folder"><i class="fa fa-file-circle-plus"></i></span>
        <span class="add-btn add-folder-btn" title="New subfolder"><i class="fa fa-folder-plus"></i></span>
        <span class="add-btn rename-folder-btn" title="Rename folder"><i class="fa fa-pen"></i></span>
        <span class="add-btn moc-btn" title="Generate folder MOC"><i class="fa fa-sitemap"></i></span>
      </span>
    `
    head.querySelector('.add-note-btn').addEventListener('click', e => {
      e.stopPropagation()
      showNewNoteBar(folderPath + '/')
    })
    head.querySelector('.rename-folder-btn').addEventListener('click', e => {
      e.stopPropagation()
      startFolderRename(head, folderPath)
    })
    head.querySelector('.add-folder-btn').addEventListener('click', e => {
      e.stopPropagation()
      showInlineFolderInput(li, folderPath + '/')
    })
    head.querySelector('.moc-btn').addEventListener('click', e => {
      e.stopPropagation()
      generateMoc(folderPath)
    })
    head.addEventListener('click', e => {
      if (e.target.closest('.folder-actions')) return
      const nowOpen = li.classList.toggle('open')
      folderOpen[folderPath] = nowOpen
      saveFolderOpen()
    })
    makeDropTarget(head, folderPath)
    li.appendChild(head)
    li.appendChild(renderTreeNode(child, folderPath))
    ul.appendChild(li)
  })
  node._notes.slice().sort((a,b) => a.title.localeCompare(b.title)).forEach(note => {
    const li = document.createElement('li')
    li.className = 'ft-note' + (note.path === currentPath ? ' active' : '') + (note.published ? '' : ' draft')
    li.dataset.path = note.path
    const lock = isPublicProps(note.properties) ? '' : '<i class="fa fa-lock" title="Private note" style="font-size:9px;color:var(--fg-4);flex-shrink:0"></i>'
    li.innerHTML = `<i class="fa fa-file-lines"></i><span>${note.title}</span>${lock}<span class="del-btn" title="Supprimer"><i class="fa fa-trash"></i></span>`
    li.querySelector('.del-btn').addEventListener('click', e => { e.stopPropagation(); deleteNote(note.path) })
    li.addEventListener('click', e => { if (e.target.closest('.del-btn')) return; loadNote(note.path) })
    makeNoteDraggable(li, note)
    // Déposer sur une note = déposer dans son dossier parent
    makeDropTarget(li, prefix)
    ul.appendChild(li)
  })
  return ul
}

function showInlineFolderInput(parentLi, prefix) {
  // parentLi = null → création à la racine de l'arbre
  const container = parentLi || document.getElementById('fileTree')
  container.querySelectorAll('.ft-folder-inline').forEach(el => el.remove())
  if (parentLi) parentLi.classList.add('open')

  const li = document.createElement('li')
  li.className = 'ft-folder-inline'
  const inp = document.createElement('input')
  inp.className = 'new-note-input'
  inp.placeholder = 'folder-name'
  li.appendChild(inp)

  const childUl = container.querySelector('.ft-ul')
  if (childUl) childUl.insertBefore(li, childUl.firstChild)
  else container.appendChild(li)

  inp.focus()

  const confirm = () => {
    const raw = inp.value.trim()
    li.remove()
    if (!raw) return
    const slug = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '')
    if (!slug) return
    const folderPath = prefix + slug
    emptyFolders.add(folderPath)
    saveEmptyFolders()
    // Ouvre le nouveau dossier et ses parents
    folderPath.split('/').reduce((acc, seg) => {
      const p = acc ? `${acc}/${seg}` : seg
      folderOpen[p] = true
      return p
    }, '')
    saveFolderOpen()
    refreshTree()
  }
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm() }
    if (e.key === 'Escape') li.remove()
  })
  inp.addEventListener('blur', () => setTimeout(() => { li.remove() }, 200))
}

function refreshTree() {
  // Nettoyage : un dossier "vide" qui contient désormais des notes devient réel
  emptyFolders.forEach(f => {
    if (allNotes.some(n => n.path.startsWith(f + '/'))) emptyFolders.delete(f)
  })
  saveEmptyFolders()

  const container = document.getElementById('fileTree')
  container.innerHTML = ''
  const notes = filteredNotes()
  if (!notes.length && !emptyFolders.size) {
    container.innerHTML = `<div style="padding:12px 14px;font-size:12px;color:var(--fg-4)">${treeFilterQuery ? 'No results.' : 'No notes.'}</div>`
    return
  }
  container.appendChild(renderTreeNode(buildTree(notes)))
}

/* ── Déplier / replier tout ── */
function setAllFolders(open) {
  const collect = (notes) => {
    const set = new Set()
    notes.forEach(n => {
      const parts = n.path.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    })
    emptyFolders.forEach(f => {
      f.split('/').reduce((acc, seg) => { const p = acc ? `${acc}/${seg}` : seg; set.add(p); return p }, '')
    })
    return set
  }
  collect(allNotes).forEach(p => { folderOpen[p] = open })
  saveFolderOpen()
  refreshTree()
}

/* ── MOC (map of content) : note générée listant les notes d'un dossier ── */
async function generateMoc(folderPath = '') {
  const mocPath = folderPath ? `${folderPath}/moc` : 'moc'
  const notes = allNotes.filter(n =>
    (folderPath ? n.path.startsWith(folderPath + '/') : true) && n.path !== mocPath
  )
  if (!notes.length) { toast('No notes in this folder', 'error'); return }

  // Groupées par sous-dossier (relatif), triées
  const groups = {}
  notes.forEach(n => {
    const rel = folderPath ? n.path.slice(folderPath.length + 1) : n.path
    const g = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    ;(groups[g] ||= []).push(n)
  })

  const title = folderPath ? `MOC — ${fmtFolder(folderPath.split('/').pop())}` : 'MOC'
  let md = `# ${title}\n`
  Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach(g => {
    if (g) md += `\n## ${g.split('/').map(fmtFolder).join(' / ')}\n`
    md += '\n'
    groups[g].sort((a, b) => a.title.localeCompare(b.title)).forEach(n => { md += `- [[${n.title}]]\n` })
  })

  // Conserve les propriétés d'une MOC existante, marque type: moc
  let props = { type: 'moc' }
  try {
    const existing = await apiGet(`/api/docs/admin/note/${mocPath}`)
    props = { ...existing.properties, type: 'moc' }
  } catch { /* pas encore de MOC */ }

  try {
    await apiPut(`/api/docs/admin/note/${mocPath}`, { title, content: md, properties: props, published: true, section: SECTION })
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
    await loadNote(mocPath)
    toast(`✓ MOC generated (${notes.length} note${notes.length > 1 ? 's' : ''})`)
  } catch { toast('MOC generation failed', 'error') }
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
document.getElementById('btnNewFolder').addEventListener('click', () => showInlineFolderInput(null, ''))
document.getElementById('btnRootMoc').addEventListener('click', () => generateMoc(''))

document.getElementById('btnToggleAll').addEventListener('click', () => {
  // Un dossier ouvert au moins → tout replier, sinon tout déplier
  const anyOpen = [...document.querySelectorAll('#fileTree .ft-folder')].some(li => li.classList.contains('open'))
  setAllFolders(!anyOpen)
  const icon = document.querySelector('#btnToggleAll i')
  icon.className = anyOpen ? 'fa fa-angles-right' : 'fa fa-angles-down'
})

/* ── Filtre de l'arborescence ── */
const treeFilterInput = document.getElementById('treeFilter')
treeFilterInput.addEventListener('input', () => {
  treeFilterQuery = treeFilterInput.value.trim()
  treeFilterInput.closest('.ft-filter').classList.toggle('active', !!treeFilterQuery)
  refreshTree()
})
treeFilterInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { treeFilterInput.value = ''; treeFilterInput.dispatchEvent(new Event('input')) }
})
document.getElementById('treeFilterClear').addEventListener('click', () => {
  treeFilterInput.value = ''
  treeFilterInput.dispatchEvent(new Event('input'))
})

/* ── Drop à la racine (zone vide de l'arbre) ── */
const fileTreeEl = document.getElementById('fileTree')
fileTreeEl.addEventListener('dragover', e => {
  if (![...e.dataTransfer.types].includes('text/note-path')) return
  if (e.target.closest('.ft-folder-head, .ft-note')) { fileTreeEl.classList.remove('drag-over-root'); return }
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  fileTreeEl.classList.add('drag-over-root')
})
fileTreeEl.addEventListener('dragleave', e => {
  if (e.target === fileTreeEl) fileTreeEl.classList.remove('drag-over-root')
})
fileTreeEl.addEventListener('drop', e => {
  fileTreeEl.classList.remove('drag-over-root')
  if (e.target.closest('.ft-folder-head, .ft-note')) return  // géré par la cible elle-même
  e.preventDefault()
  const oldPath = e.dataTransfer.getData('text/note-path')
  if (!oldPath || !oldPath.includes('/')) return
  moveNote(oldPath, oldPath.split('/').pop())
})

/* ── Renommage / déplacement via le panneau de droite ── */
function renameFromPanel() {
  if (!currentPath) { toast('No note loaded', 'error'); return }
  const raw = document.getElementById('propsPathInput').value.trim()
  const cleaned = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '').replace(/^\/+|\/+$/g, '')
  if (!cleaned) { toast('Invalid path', 'error'); return }
  document.getElementById('propsPathInput').value = cleaned
  if (cleaned === currentPath) return
  moveNote(currentPath, cleaned)
}
document.getElementById('renameBtn').addEventListener('click', renameFromPanel)
document.getElementById('propsPathInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); renameFromPanel() }
  if (e.key === 'Escape') document.getElementById('propsPathInput').value = currentPath || ''
})
document.getElementById('btnCancelNew').addEventListener('click', () => document.getElementById('newNoteBar').classList.remove('show'))
document.getElementById('btnCreate').addEventListener('click', createNote)
document.getElementById('newNotePath').addEventListener('keydown', e => {
  if (e.key === 'Enter') createNote()
  if (e.key === 'Escape') document.getElementById('newNoteBar').classList.remove('show')
})

function createNote() {
  flushAutosave()   // sauvegarde les modifications en attente de la note précédente
  const raw = document.getElementById('newNotePath').value.trim()
  let p = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '')
  if (!p) return

  // If path ends with / (created via folder button with no note name added), append 'index'
  if (p.endsWith('/')) p += 'index'

  document.getElementById('newNoteBar').classList.remove('show')
  currentPath = null
  const title = fmtFolder(p.split('/').pop())
  document.getElementById('notePath').value = p
  document.getElementById('propsPathInput').value = p
  document.getElementById('noteTitle').value = title
  editor.commands.setContent(`# ${title}\n\n`)
  noteProps = {}; renderProperties()
  document.getElementById('publishedToggle').checked = true
  document.getElementById('propsMeta').textContent = ''
  document.getElementById('previewLink').href = '#'
  editor.commands.focus('end')
  // Proposer un template pour la nouvelle note
  if (allTemplates.length) openTplPicker()
}

// No auto-slash on blur — too aggressive, caused accidental path mangling

/* ════════════════════════════════════════════════
   LOAD / SAVE / DELETE
════════════════════════════════════════════════ */
/* ── Autosave ──
   Déclenché après chaque modification (contenu, titre, propriétés, toggles),
   avec un délai depuis la dernière frappe. Ne concerne que les notes déjà
   sauvegardées une première fois (currentPath) et jamais un renommage :
   le champ path doit correspondre à la note chargée. */
const AUTOSAVE_DELAY = 1500
let autosaveTimer = null

function setAutosaveStatus(state) {
  const el = document.getElementById('autosaveStatus')
  if (!el) return
  if      (state === 'pending') { el.textContent = '●'; el.style.color = 'var(--fg-4)' }
  else if (state === 'saving')  { el.textContent = '● saving…'; el.style.color = 'var(--warning)' }
  else if (state === 'saved')   { el.textContent = `✓ saved ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`; el.style.color = 'var(--green)' }
  else if (state === 'error')   { el.textContent = '⚠ autosave failed — Ctrl+S to retry'; el.style.color = 'var(--danger)' }
  else el.textContent = ''
}

function scheduleAutosave() {
  if (!currentPath) return
  setAutosaveStatus('pending')
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => { autosaveTimer = null; saveNote({ auto: true }) }, AUTOSAVE_DELAY)
}

// Capture les champs de façon synchrone puis sauvegarde — sûr à appeler
// juste avant de charger/réinitialiser l'éditeur, sans await.
function flushAutosave() {
  if (!autosaveTimer) return
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  saveNote({ auto: true })
}

function cancelAutosave() {
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  setAutosaveStatus('')
}

// Dernier filet : sauvegarde en arrière-plan si on quitte la page avec des
// modifications en attente (keepalive survit à la fermeture de l'onglet).
window.addEventListener('beforeunload', () => {
  if (!autosaveTimer || !currentPath) return
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  const path = document.getElementById('notePath').value.trim().replace(/^\/+|\/+$/g, '')
  if (path !== currentPath) return
  noteProps.public = document.getElementById('publicToggle').checked
  fetch(`/api/docs/admin/note/${path}`, {
    method: 'PUT', credentials: 'include', keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: document.getElementById('noteTitle').value.trim() || 'Untitled',
      content: editor.storage.markdown.getMarkdown(),
      properties: noteProps,
      published: document.getElementById('publishedToggle').checked,
      section: SECTION,
    })
  })
})

async function loadNote(p) {
  flushAutosave()
  try {
    const note = await apiGet(`/api/docs/admin/note/${p}`)
    currentPath = p
    document.getElementById('notePath').value  = note.path
    document.getElementById('propsPathInput').value = note.path
    document.getElementById('noteTitle').value = note.title
    editor.commands.setContent(note.content || '')
    // Migrate legacy tags array → noteProps.tags string
    const rawProps = note.properties || {}
    if (Array.isArray(rawProps.tags)) rawProps.tags = rawProps.tags.join(', ')
    noteProps = rawProps
    renderProperties()
    document.getElementById('publishedToggle').checked = !!note.published
    document.getElementById('previewLink').href = `${PUBLIC_BASE}/${note.path}`
    const upd = note.updated_at ? new Date(note.updated_at).toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' }) : ''
    document.getElementById('propsMeta').innerHTML = upd ? `Updated ${upd}<br/><code style="font-size:10px">${escHtml(note.path)}</code>` : ''
    refreshTree()
    editor.commands.focus()
  } catch { toast('Load failed', 'error') }
}

async function saveNote(opts = {}) {
  const auto = opts.auto === true
  // Une sauvegarde (manuelle ou auto) annule le timer d'autosave en attente
  clearTimeout(autosaveTimer); autosaveTimer = null

  const rawPath   = document.getElementById('notePath').value.trim()
  // Always strip leading/trailing slashes — avoids "dfir/registry/" accidents
  const path      = rawPath.replace(/^\/+|\/+$/g, '')
  // Autosave : uniquement une note existante, jamais de création/renommage implicite
  if (auto && (!currentPath || path !== currentPath)) return
  document.getElementById('notePath').value = path
  const title     = document.getElementById('noteTitle').value.trim() || 'Untitled'
  const content   = editor.storage.markdown.getMarkdown()
  const published = document.getElementById('publishedToggle').checked

  if (!path) { toast('Path required', 'error'); return }
  // Check : pas d'espaces ni de caractères hors slug dans le nom de la note
  if (/\s/.test(path)) { toast('Path must not contain spaces', 'error'); return }
  if (!/^[a-zA-Z0-9\-_]+(\/[a-zA-Z0-9\-_]+)*$/.test(path)) {
    toast('Invalid path (letters, digits, dashes, underscores and / only)', 'error'); return
  }

  const propsSnapshot = { ...noteProps, public: document.getElementById('publicToggle').checked }
  if (!auto) noteProps = propsSnapshot

  // If path changed → delete old
  if (currentPath && currentPath !== path) {
    await apiDel(`/api/docs/admin/note/${currentPath}`).catch(() => {})
  }

  if (auto) setAutosaveStatus('saving')
  try {
    const saved = await apiPut(`/api/docs/admin/note/${path}`, { title, content, properties: propsSnapshot, published, section: SECTION })
    if (auto) {
      // Maj légère : pas de re-fetch complet, on met à jour l'entrée locale
      // puis on re-render l'arbre pour garder titres / tri / verrous en phase.
      const entry = allNotes.find(n => n.path === path)
      if (entry) {
        entry.title = title
        entry.published = published ? 1 : 0
        entry.properties = saved.properties || propsSnapshot
      }
      if (currentPath === path) {
        if (saved.properties) {
          // Fusionne uniquement les clés auto (created/updated/creator) et ne
          // re-render que si elles ont changé — évite de perdre le focus d'un
          // champ propriété en cours d'édition.
          const changedAuto = AUTO_PROPS.some(k => String(noteProps[k] ?? '') !== String(saved.properties[k] ?? ''))
          AUTO_PROPS.forEach(k => { if (saved.properties[k] !== undefined) noteProps[k] = saved.properties[k] })
          noteProps.public = propsSnapshot.public
          if (changedAuto) renderProperties()
        }
        setAutosaveStatus('saved')
      }
      refreshTree()
      return
    }
    if (saved.properties) { noteProps = saved.properties; renderProperties() }
    currentPath = path
    document.getElementById('propsPathInput').value = path
    toast(`✓ ${path} saved`)
    setAutosaveStatus('saved')
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
  } catch (e) {
    if (auto) { setAutosaveStatus('error'); return }
    toast(e.message && e.message !== '401' ? e.message : 'Save failed', 'error')
  }
}

async function deleteNote(p) {
  if (!confirm(`Delete "${p}"?`)) return
  // Ne pas laisser un autosave en attente recréer la note supprimée
  if (currentPath === p) cancelAutosave()
  try {
    await apiDel(`/api/docs/admin/note/${p}`)
    if (currentPath === p) {
      currentPath = null
      document.getElementById('notePath').value = ''
      document.getElementById('propsPathInput').value = ''
      document.getElementById('noteTitle').value = ''
      editor.commands.setContent('')
      noteProps = {}; renderProperties()
    }
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
    toast('Note deleted')
  } catch { toast('Delete failed', 'error') }
}

/* ════════════════════════════════════════════════
   SAVE BUTTONS + Ctrl+S
════════════════════════════════════════════════ */
document.getElementById('saveBtn').addEventListener('click', () => saveNote())
document.getElementById('saveBtnProps').addEventListener('click', () => saveNote())
document.getElementById('deleteBtn').addEventListener('click', () => { if (currentPath) deleteNote(currentPath) })
document.getElementById('noteTitle').addEventListener('input', scheduleAutosave)
document.getElementById('publishedToggle').addEventListener('change', scheduleAutosave)
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
let tplProps      = {}     // métadonnées du template en cours d'édition

/* ── Métadonnées du template (modal) ── */
function renderTplProps() {
  const wrap = document.getElementById('tplPropsRows')
  wrap.innerHTML = ''
  Object.entries(tplProps).forEach(([key, value]) => {
    const row = document.createElement('div')
    row.className = 'prop-row'
    row.innerHTML = `
      <span class="prop-key-label" title="${escHtml(key)}">${escHtml(key)}</span>
      <span class="prop-colon">:</span>
      <input class="prop-val-edit" value="${escHtml(String(value))}"/>
      <button class="prop-del" title="Delete">×</button>
    `
    const valInput = row.querySelector('.prop-val-edit')
    valInput.addEventListener('input', () => { tplProps[key] = valInput.value })
    row.querySelector('.prop-del').addEventListener('click', () => {
      delete tplProps[key]
      renderTplProps()
    })
    wrap.appendChild(row)
  })
}

function addTplProp() {
  const keyEl = document.getElementById('tplPropKeyInput')
  const valEl = document.getElementById('tplPropValInput')
  const key = keyEl.value.trim()
  if (!key) { keyEl.focus(); return }
  tplProps[key] = valEl.value.trim()
  keyEl.value = ''; valEl.value = ''
  renderTplProps()
  keyEl.focus()
}
document.getElementById('tplPropAddBtn').addEventListener('click', addTplProp)
document.getElementById('tplPropKeyInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('tplPropValInput').focus() }
})
document.getElementById('tplPropValInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addTplProp() }
})

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
      Placeholder.configure({ placeholder: 'Template content…' }),
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
    list.innerHTML = '<div class="tpl-list-empty">No templates.<br/>Click + to create one.</div>'
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
  tplProps = { ...(tpl.properties || {}) }
  renderTplProps()
  renderTplModalList()
}

function newTpl() {
  currentTplId = null
  document.getElementById('tplModalName').value = ''
  tplEditor?.commands.setContent('')
  tplProps = {}
  renderTplProps()
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
  tplProps = { ...noteProps }   // reprend aussi les métadonnées de la note
  renderTplProps()
  renderTplModalList()
  document.getElementById('tplModalName').focus()
  document.getElementById('tplModalName').select()
})

/* ── Save ── */
document.getElementById('tplModalSave').addEventListener('click', async () => {
  const name = document.getElementById('tplModalName').value.trim()
  if (!name) { document.getElementById('tplModalName').focus(); toast('Give the template a name', 'error'); return }

  // Detect name conflict (different id)
  const conflict = allTemplates.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== currentTplId)
  if (conflict && !confirm(`A template named "${name}" already exists. Replace it?`)) return

  const content = tplEditor.storage.markdown.getMarkdown()

  try {
    const saved = await fetch('/api/docs/admin/templates', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, tags: [], properties: tplProps })
    }).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })

    currentTplId = saved.id
    await fetchTemplates()
    renderTplModalList()
    toast(`Template "${name}" saved`)
  } catch { toast('Template save failed', 'error') }
})

/* ── Insertion dans la note (au curseur, sans remplacer le contenu) ── */
function applyTemplateToNote(tpl) {
  if (!editor) return
  const content = tpl.content || ''
  const props   = tpl.properties || {}
  if (content.trim()) {
    const { $from } = editor.state.selection
    if ($from.parent.type.name === 'heading') {
      // Curseur dans un titre : insérer après le bloc, jamais fusionner dedans
      editor.chain().focus().insertContentAt($from.after($from.depth), content).run()
    } else {
      editor.chain().focus().insertContent(content).run()
    }
  }
  // Fusion des métadonnées : les clés déjà renseignées sur la note sont conservées
  let added = 0
  Object.entries(props).forEach(([k, v]) => {
    if (!(k in noteProps) || noteProps[k] === '') { noteProps[k] = v; added++ }
  })
  renderProperties()
  toast('Template inserted' + (added ? ` · ${added} propert${added > 1 ? 'ies' : 'y'}` : ''))
}

document.getElementById('tplModalApply').addEventListener('click', () => {
  if (!editor || !tplEditor) return
  const content = tplEditor.storage.markdown.getMarkdown()
  if (!content.trim() && !Object.keys(tplProps).length) { toast('Empty template', 'error'); return }
  applyTemplateToNote({ content, properties: { ...tplProps } })
  closeTplModal()
  editor.commands.focus()
})

/* ── Delete ── */
document.getElementById('tplModalDelete').addEventListener('click', async () => {
  if (!currentTplId) { toast('No template selected', 'error'); return }
  const tpl = allTemplates.find(t => t.id === currentTplId)
  if (!confirm(`Delete template "${tpl?.name}"?`)) return
  try {
    await apiDel(`/api/docs/admin/templates/${currentTplId}`)
    toast('Template deleted')
    await fetchTemplates()
    currentTplId = null
    renderTplModalList()
    if (allTemplates.length) selectTpl(allTemplates[0])
    else newTpl()
  } catch { toast('Template delete failed', 'error') }
})

/* ════════════════════════════════════════════════
   TEMPLATE PICKER — proposé à la création d'une note
════════════════════════════════════════════════ */
let tplPickIdx = 0

function openTplPicker() {
  const overlay = document.getElementById('tplPickOverlay')
  const list    = document.getElementById('tplPickList')
  list.innerHTML = ''
  tplPickIdx = 0
  allTemplates.forEach((tpl, i) => {
    const item = document.createElement('div')
    item.className = 'tpl-pick-item' + (i === 0 ? ' active' : '')
    const nProps = Object.keys(tpl.properties || {}).length
    item.innerHTML = `<i class="fa fa-file-code"></i><span>${escHtml(tpl.name)}</span>` +
      (nProps ? `<span class="tpl-pick-props">${nProps} prop.</span>` : '')
    item.addEventListener('click', () => { closeTplPicker(); applyTemplateToNote(tpl) })
    item.addEventListener('mouseenter', () => setTplPickActive(i))
    list.appendChild(item)
  })
  overlay.classList.add('open')
}

function setTplPickActive(i) {
  tplPickIdx = i
  document.querySelectorAll('.tpl-pick-item').forEach((el, j) => el.classList.toggle('active', j === i))
}

function closeTplPicker() {
  document.getElementById('tplPickOverlay').classList.remove('open')
  editor?.commands.focus('end')
}

document.getElementById('tplPickNone').addEventListener('click', closeTplPicker)
document.getElementById('tplPickOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('tplPickOverlay')) closeTplPicker()
})
document.addEventListener('keydown', e => {
  const overlay = document.getElementById('tplPickOverlay')
  if (!overlay.classList.contains('open')) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTplPicker() }
  if (e.key === 'ArrowDown') { e.preventDefault(); setTplPickActive((tplPickIdx + 1) % allTemplates.length) }
  if (e.key === 'ArrowUp')   { e.preventDefault(); setTplPickActive((tplPickIdx - 1 + allTemplates.length) % allTemplates.length) }
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation()
    const tpl = allTemplates[tplPickIdx]
    closeTplPicker()
    if (tpl) applyTemplateToNote(tpl)
  }
}, true)  // capture : prioritaire sur les raccourcis de l'éditeur

/* ════════════════════════════════════════════════
   WIKILINK "CREATE NOTE" MODAL
   Ouvert au clic sur un [[wikilink]] qui ne résout
   vers aucune note : titre pré-rempli, choix du
   dossier et d'un template, puis création + ouverture.
════════════════════════════════════════════════ */
let wikiCreateOverlay = null

function allFolderPaths() {
  const set = new Set()
  allNotes.forEach(n => {
    const parts = n.path.split('/')
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
  })
  emptyFolders.forEach(f => {
    f.split('/').reduce((acc, seg) => { const p = acc ? `${acc}/${seg}` : seg; set.add(p); return p }, '')
  })
  return [...set].sort((a, b) => a.localeCompare(b))
}

function slugify(s) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '')
}

function closeWikiCreateModal() {
  wikiCreateOverlay?.remove()
  wikiCreateOverlay = null
}

function openWikiCreateModal(target) {
  closeWikiCreateModal()
  const folders = allFolderPaths()
  // Pré-sélectionne le dossier de la note en cours d'édition
  const currentFolder = currentPath && currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''

  const fieldStyle = 'width:100%;background:var(--card-3);border:1px solid var(--line-2);border-radius:4px;color:var(--fg);font-family:var(--mono);font-size:12px;padding:7px 9px;outline:none'
  const labelStyle = 'display:flex;flex-direction:column;gap:5px;font-family:var(--mono);font-size:10px;color:var(--fg-3);letter-spacing:.06em;text-transform:uppercase'

  const overlay = document.createElement('div')
  overlay.className = 'tpl-pick-overlay open'
  overlay.innerHTML = `
    <div class="tpl-pick" style="max-height:none">
      <div class="tpl-pick-title"><i class="fa fa-file-circle-plus"></i> Create linked note</div>
      <div style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <label style="${labelStyle}">Title
          <input id="wikiCreateTitle" style="${fieldStyle}" value="${escHtml(target)}" autocomplete="off"/>
        </label>
        <label style="${labelStyle}">Folder
          <select id="wikiCreateFolder" style="${fieldStyle}">
            <option value="">/ (root)</option>
            ${folders.map(f => `<option value="${escHtml(f)}"${f === currentFolder ? ' selected' : ''}>${escHtml(f)}</option>`).join('')}
          </select>
        </label>
        <label style="${labelStyle}">Template
          <select id="wikiCreateTpl" style="${fieldStyle}">
            <option value="">None</option>
            ${allTemplates.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('')}
          </select>
        </label>
        <div style="font-family:var(--mono);font-size:10px;color:var(--fg-4)">→ <code id="wikiCreatePath"></code></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--line);background:var(--deep)">
        <button class="btn btn-ghost btn-sm" id="wikiCreateCancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="wikiCreateOk"><i class="fa fa-check"></i> Create</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  wikiCreateOverlay = overlay

  const titleInput = overlay.querySelector('#wikiCreateTitle')
  const folderSel  = overlay.querySelector('#wikiCreateFolder')
  const pathEl     = overlay.querySelector('#wikiCreatePath')

  const computedPath = () => {
    const slug = slugify(titleInput.value) || '…'
    return folderSel.value ? `${folderSel.value}/${slug}` : slug
  }
  const updatePath = () => { pathEl.textContent = computedPath() }
  updatePath()
  titleInput.addEventListener('input', updatePath)
  folderSel.addEventListener('change', updatePath)

  const confirm = async () => {
    const title = titleInput.value.trim() || 'Untitled'
    const slug  = slugify(title)
    if (!slug) { toast('Invalid title', 'error'); titleInput.focus(); return }
    const path = folderSel.value ? `${folderSel.value}/${slug}` : slug
    if (allNotes.some(n => n.path === path)) { toast('A note already exists at this path', 'error'); return }

    const tpl = allTemplates.find(t => t.name === overlay.querySelector('#wikiCreateTpl').value)
    const content = `# ${title}\n\n` + (tpl?.content || '')
    const props   = { ...(tpl?.properties || {}) }

    try {
      await apiPut(`/api/docs/admin/note/${path}`, { title, content, properties: props, published: true, section: SECTION })
      allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
      closeWikiCreateModal()
      refreshTree()
      await loadNote(path)
      toast(`✓ ${path} created`)
    } catch { toast('Create failed', 'error') }
  }

  overlay.querySelector('#wikiCreateOk').addEventListener('click', confirm)
  overlay.querySelector('#wikiCreateCancel').addEventListener('click', closeWikiCreateModal)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWikiCreateModal() })
  overlay.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter' && e.target !== folderSel && e.target.id !== 'wikiCreateTpl') { e.preventDefault(); confirm() }
    if (e.key === 'Escape') closeWikiCreateModal()
  })

  titleInput.focus()
  titleInput.select()
}

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
async function init() {
  initEditor()
  renderProperties()
  fetchTemplates()   // preload, tplEditor lazy-init on first modal open
  // Set the tree panel title based on section
  const treeTitle = document.querySelector('.ft-head-title')
  if (treeTitle) treeTitle.textContent = SECTION === 'remora' ? 'Remora Docs' : 'Knowledge Base'
  try {
    allNotes = await apiGet(`/api/docs/admin/all?section=${SECTION}`)
    refreshTree()
  } catch (e) {
    if (e.message !== '401') toast('Failed to load notes', 'error')
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  location.href = '/admin/login'
})

init()
