/* ════════════════════════════════════════════════
   EXCALIDRAW EDITING MODAL — lazy-loaded on demand
   Not imported at the top of docs.js: only reached via a dynamic import(),
   so Vite code-splits Excalidraw (+ React) into its own chunk that never
   loads unless a user actually opens the diagram editor. Without this the
   admin docs.js bundle balloons from ~275KB to ~2.9MB (measured directly),
   which every admin page load would otherwise pay for.
════════════════════════════════════════════════ */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw'

let overlayEl = null
let root = null

function ensureOverlay() {
  if (overlayEl) return overlayEl
  overlayEl = document.createElement('div')
  overlayEl.className = 'excalidraw-modal-overlay'
  overlayEl.innerHTML = `
    <div class="excalidraw-modal">
      <div class="excalidraw-modal-header">
        <span class="excalidraw-modal-header-title"><i class="fa fa-diagram-project"></i>&nbsp; Diagram</span>
        <button class="tpl-modal-close" id="excalidrawModalClose" title="Close (discard)">&times;</button>
      </div>
      <div class="excalidraw-modal-canvas">
        <div class="excalidraw-modal-loading"><i class="fa fa-spinner fa-spin"></i>&nbsp; Loading editor…</div>
        <div id="excalidrawRoot" style="width:100%;height:100%"></div>
      </div>
      <div class="excalidraw-modal-footer">
        <button class="btn btn-ghost btn-sm" id="excalidrawModalCancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="excalidrawModalSave"><i class="fa fa-floppy-disk"></i> Save diagram</button>
      </div>
    </div>
  `
  document.body.appendChild(overlayEl)
  return overlayEl
}

function close() {
  if (!overlayEl) return
  overlayEl.remove()
  overlayEl = null
  if (root) { root.unmount(); root = null }
}

/**
 * @param {{sceneUrl?: string|null, svg?: string}} initial
 * @param {(result: {sceneUrl: string, svg: string}) => void} onSave
 */
export async function openExcalidrawModal(initial, onSave) {
  const el = ensureOverlay()
  const loading = el.querySelector('.excalidraw-modal-loading')
  const canvasRoot = el.querySelector('#excalidrawRoot')

  el.querySelector('#excalidrawModalClose').addEventListener('click', close)
  el.querySelector('#excalidrawModalCancel').addEventListener('click', close)
  el.addEventListener('mousedown', e => { if (e.target === el) close() })

  let initialData = { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
  if (initial?.sceneUrl) {
    try {
      const scene = await (await fetch(initial.sceneUrl, { credentials: 'include' })).json()
      initialData = { elements: scene.elements || [], appState: scene.appState || {}, files: scene.files || {} }
    } catch { /* fall back to a blank canvas if the scene file can't be loaded */ }
  }

  let excalidrawAPI = null
  root = createRoot(canvasRoot)
  root.render(
    createElement(Excalidraw, {
      excalidrawAPI: api => { excalidrawAPI = api; loading.style.display = 'none' },
      initialData,
    })
  )

  el.querySelector('#excalidrawModalSave').addEventListener('click', async () => {
    if (!excalidrawAPI) return
    const saveBtn = el.querySelector('#excalidrawModalSave')
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving…'
    try {
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()
      const files = excalidrawAPI.getFiles()

      const svgEl = await exportToSvg({ elements, appState, files, exportPadding: 12 })
      const svg = new XMLSerializer().serializeToString(svgEl)

      const res = await fetch('/api/docs/admin/upload-diagram', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: { elements, appState, files } }),
      })
      if (!res.ok) throw new Error('Upload failed')
      const { url } = await res.json()

      onSave({ sceneUrl: url, svg })
      close()
    } catch {
      saveBtn.disabled = false
      saveBtn.textContent = 'Save diagram'
      alert('Failed to save the diagram — please try again.')
    }
  })
}
