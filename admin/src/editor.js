import './style.css'
import { api, toast } from './api.js'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin } from '@tiptap/pm/state'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)
const params = new URLSearchParams(location.search)
const articleId = params.get('id')
let currentStatus = 'draft'

// Upload d'image (fichier ou clipboard)
async function uploadImage(file) {
  const fd = new FormData()
  fd.append('image', file)
  const data = await api.upload('/api/uploads', fd)
  return data.url
}

// Extension image avec paste depuis clipboard
const ImageWithPaste = Image.extend({
  addProseMirrorPlugins() {
    const getEditor = () => this.editor
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const items = event.clipboardData?.items
            if (!items) return false
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                event.preventDefault()
                const file = item.getAsFile()
                uploadImage(file).then(url => {
                  getEditor().chain().focus().setImage({ src: url }).run()
                }).catch(() => toast('Erreur upload image', 'error'))
                return true
              }
            }
            return false
          },
          handleDrop(view, event) {
            const files = event.dataTransfer?.files
            if (!files?.length) return false
            const imgs = [...files].filter(f => f.type.startsWith('image/'))
            if (!imgs.length) return false
            event.preventDefault()
            imgs.forEach(file => {
              uploadImage(file).then(url => {
                getEditor().chain().focus().setImage({ src: url }).run()
              }).catch(() => toast('Erreur upload image', 'error'))
            })
            return true
          }
        }
      })
    ]
  }
})

const editor = new Editor({
  element: document.getElementById('editor'),
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    ImageWithPaste.configure({ inline: false, allowBase64: false }),
    Link.configure({ openOnClick: false }),
    Underline,
    Table.configure({ resizable: true }),
    TableRow, TableHeader, TableCell,
    CodeBlockLowlight.configure({ lowlight }),
  ],
  content: '',
  editorProps: {
    attributes: { 'data-placeholder': 'Commencez à écrire…' }
  },
  onUpdate: () => updateToolbarState(),
  onSelectionUpdate: () => updateToolbarState(),
})

// Toolbar
function updateToolbarState() {
  document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd
    let active = false
    if (cmd === 'bold')        active = editor.isActive('bold')
    else if (cmd === 'italic') active = editor.isActive('italic')
    else if (cmd === 'underline') active = editor.isActive('underline')
    else if (cmd === 'strike') active = editor.isActive('strike')
    else if (cmd === 'h1')     active = editor.isActive('heading', { level: 1 })
    else if (cmd === 'h2')     active = editor.isActive('heading', { level: 2 })
    else if (cmd === 'h3')     active = editor.isActive('heading', { level: 3 })
    else if (cmd === 'bulletList')  active = editor.isActive('bulletList')
    else if (cmd === 'orderedList') active = editor.isActive('orderedList')
    else if (cmd === 'blockquote')  active = editor.isActive('blockquote')
    else if (cmd === 'codeBlock')   active = editor.isActive('codeBlock')
    else if (cmd === 'code')        active = editor.isActive('code')
    else if (cmd === 'link')        active = editor.isActive('link')
    btn.classList.toggle('active', active)
  })
}

document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const cmd = btn.dataset.cmd
    if (cmd === 'bold')        editor.chain().focus().toggleBold().run()
    else if (cmd === 'italic') editor.chain().focus().toggleItalic().run()
    else if (cmd === 'underline') editor.chain().focus().toggleUnderline().run()
    else if (cmd === 'strike') editor.chain().focus().toggleStrike().run()
    else if (cmd === 'h1')     editor.chain().focus().toggleHeading({ level: 1 }).run()
    else if (cmd === 'h2')     editor.chain().focus().toggleHeading({ level: 2 }).run()
    else if (cmd === 'h3')     editor.chain().focus().toggleHeading({ level: 3 }).run()
    else if (cmd === 'bulletList')  editor.chain().focus().toggleBulletList().run()
    else if (cmd === 'orderedList') editor.chain().focus().toggleOrderedList().run()
    else if (cmd === 'blockquote')  editor.chain().focus().toggleBlockquote().run()
    else if (cmd === 'codeBlock')   editor.chain().focus().toggleCodeBlock().run()
    else if (cmd === 'code')        editor.chain().focus().toggleCode().run()
    else if (cmd === 'hr')          editor.chain().focus().setHorizontalRule().run()
    else if (cmd === 'undo')        editor.chain().focus().undo().run()
    else if (cmd === 'redo')        editor.chain().focus().redo().run()
    else if (cmd === 'link') {
      const prev = editor.getAttributes('link').href || ''
      const url = prompt('URL du lien :', prev)
      if (url === null) return
      if (url === '') editor.chain().focus().unsetLink().run()
      else editor.chain().focus().setLink({ href: url }).run()
    }
    else if (cmd === 'image') document.getElementById('imageFileInput').click()
    else if (cmd === 'table') editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  })
})

document.getElementById('imageFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  try {
    const url = await uploadImage(file)
    editor.chain().focus().setImage({ src: url }).run()
  } catch { toast('Erreur upload image', 'error') }
  e.target.value = ''
})

// Statut
let publishStatus = 'draft'
document.getElementById('btnDraft').addEventListener('click', () => setStatus('draft'))
document.getElementById('btnPublish').addEventListener('click', () => setStatus('published'))

function setStatus(s) {
  publishStatus = s
  document.getElementById('btnDraft').className = 'status-btn' + (s === 'draft' ? ' active-draft' : '')
  document.getElementById('btnPublish').className = 'status-btn' + (s === 'published' ? ' active-published' : '')
}

// Cover image
document.getElementById('coverPickBtn').addEventListener('click', () => document.getElementById('coverFileInput').click())
document.getElementById('coverFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  try {
    const url = await uploadImage(file)
    const preview = document.getElementById('coverPreview')
    preview.src = url
    preview.style.display = 'block'
    preview.dataset.url = url
  } catch { toast('Erreur upload image de couverture', 'error') }
  e.target.value = ''
})

// Sauvegarde
document.getElementById('saveBtn').addEventListener('click', save)
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() } })

async function save() {
  const title = document.getElementById('titleInput').value.trim()
  if (!title) { toast('Le titre est requis', 'error'); return }

  const btn = document.getElementById('saveBtn')
  btn.disabled = true

  const payload = {
    title,
    content: editor.getHTML(),
    excerpt: document.getElementById('excerptInput').value.trim(),
    cover_image: document.getElementById('coverPreview').dataset.url || null,
    status: publishStatus,
  }

  try {
    if (articleId) {
      await api.put(`/api/articles/${articleId}`, payload)
      toast('Article mis à jour')
    } else {
      const created = await api.post('/api/articles', payload)
      toast('Article créé')
      history.replaceState({}, '', `/admin/editor?id=${created.id}`)
      document.getElementById('pageTitle').textContent = 'Éditer l\'article'
    }
  } catch (e) { toast(e.message, 'error') }
  btn.disabled = false
}

// Chargement en édition
if (articleId) {
  document.getElementById('pageTitle').textContent = 'Éditer l\'article'
  api.get(`/api/articles/admin/${articleId}`).then(a => {
    document.getElementById('titleInput').value = a.title
    document.getElementById('excerptInput').value = a.excerpt || ''
    editor.commands.setContent(a.content || '')
    setStatus(a.status)
    if (a.cover_image) {
      const p = document.getElementById('coverPreview')
      p.src = a.cover_image
      p.style.display = 'block'
      p.dataset.url = a.cover_image
    }
  }).catch(() => toast('Erreur de chargement', 'error'))
}

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await api.post('/api/auth/logout')
  window.location.href = '/admin/login'
})
