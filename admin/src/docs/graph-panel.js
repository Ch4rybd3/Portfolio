/* ════════════════════════════════════════════════
   RELATION GRAPH PANEL (admin)
   Same rendering approach as the public KB page: the graph endpoint only
   ever needs to answer "who links to/from this note", so a plain radial
   layout (current note centered, neighbors evenly spaced on a circle) is
   both simpler and more predictable than running a physics simulation —
   no extra dependency needed for this.
════════════════════════════════════════════════ */

let graphData = { nodes: [], edges: [] }
let graphSection = null

export async function loadGraphData(section) {
  graphSection = section
  try {
    graphData = await (await fetch(`/api/docs/admin/graph?section=${section}`, { credentials: 'include' })).json()
  } catch {
    graphData = { nodes: [], edges: [] }
  }
}

export function renderAdminGraphPanel(notePath, onNavigate) {
  const group = document.getElementById('graphGroup')
  const svg = document.getElementById('adminGraphSvg')
  if (!group || !svg) return

  const neighborPaths = new Set()
  graphData.edges.forEach(e => {
    if (e.source === notePath) neighborPaths.add(e.target)
    else if (e.target === notePath) neighborPaths.add(e.source)
  })

  if (!notePath || !neighborPaths.size) { group.style.display = 'none'; return }
  group.style.display = 'block'

  const titleByPath = new Map(graphData.nodes.map(n => [n.path, n.title]))
  const W = 200, H = 170, cx = W / 2, cy = H / 2 - 6
  const R = Math.min(H, W) / 2 - 34
  const NS = 'http://www.w3.org/2000/svg'

  svg.innerHTML = ''
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag)
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    return el
  }

  const neighbors = [...neighborPaths].map((p, i, arr) => {
    const angle = (2 * Math.PI * i) / arr.length - Math.PI / 2
    return { path: p, title: titleByPath.get(p) || p, x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
  })

  neighbors.forEach(n => svg.appendChild(svgEl('line', { class: 'graph-edge', x1: cx, y1: cy, x2: n.x, y2: n.y })))

  const curG = svgEl('g', { class: 'graph-node current' })
  curG.appendChild(svgEl('circle', { cx, cy, r: 8 }))
  const curLabel = svgEl('text', { class: 'graph-node-label', x: cx, y: cy + 20, 'text-anchor': 'middle' })
  curLabel.textContent = titleByPath.get(notePath) || notePath
  curG.appendChild(curLabel)
  svg.appendChild(curG)

  neighbors.forEach(n => {
    const g = svgEl('g', { class: 'graph-node neighbor' })
    g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 5.5 }))
    const label = svgEl('text', {
      class: 'graph-node-label', x: n.x, y: n.y + (n.y >= cy ? 16 : -10), 'text-anchor': 'middle',
    })
    label.textContent = n.title
    g.appendChild(label)
    g.addEventListener('click', () => onNavigate(n.path))
    svg.appendChild(g)
  })
}
