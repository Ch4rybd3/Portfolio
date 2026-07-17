const db = require('./db')

/* ── Helpers partagés entre les routes docs / remora / export ── */

function parseNote(n) {
  if (!n) return null
  return { ...n, properties: JSON.parse(n.properties || '{}') }
}

// Chemins valides : segments a-z 0-9 - _ séparés par / (jamais d'espace)
const PATH_RE = /^[a-zA-Z0-9\-_]+(\/[a-zA-Z0-9\-_]+)*$/
function pathError(p) {
  if (!p) return 'Path required'
  if (/\s/.test(p)) return 'Path must not contain spaces'
  if (!PATH_RE.test(p)) return 'Invalid path (letters, digits, dashes, underscores and / only)'
  return null
}

// Visibilité publique : la propriété `public` doit être absente ou ≠ false
// (json_extract renvoie 0 pour le booléen JSON false, 'false' pour la chaîne)
const PUBLIC_SQL = `(json_extract(properties, '$.public') IS NULL OR json_extract(properties, '$.public') NOT IN ('false', 0))`
function isPublicNote(props) {
  const v = props?.public
  return v === undefined || v === null || v === '' || (v !== false && v !== 'false' && v !== 0)
}

/* ── MOC globale : régénérée à chaque écriture dans la section ──
   Si la MOC est publique elle ne liste que les notes publiques
   (pas de fuite de titres privés) ; privée, elle liste tout. */
function fmtFolder(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function regenerateRootMoc(section = 'kb') {
  try {
    const existing = db.prepare(`SELECT properties FROM docs_notes WHERE path = 'moc' AND section = ?`).get(section)
    let props = { type: 'moc' }
    if (existing) props = { ...JSON.parse(existing.properties || '{}'), type: 'moc' }
    const mocIsPublic = isPublicNote(props)

    const rows = db.prepare(`
      SELECT path, title, properties, published FROM docs_notes
      WHERE section = ? AND path != 'moc' ORDER BY path
    `).all(section).map(parseNote)
    const notes = rows.filter(n => mocIsPublic ? (n.published && isPublicNote(n.properties)) : true)

    const groups = {}
    notes.forEach(n => {
      const g = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
      ;(groups[g] ||= []).push(n)
    })
    let md = '# MOC\n'
    Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach(g => {
      if (g) md += `\n## ${g.split('/').map(fmtFolder).join(' / ')}\n`
      md += '\n'
      groups[g].sort((a, b) => a.title.localeCompare(b.title)).forEach(n => { md += `- [[${n.title}]]\n` })
    })

    db.prepare(`
      INSERT INTO docs_notes (path, title, content, properties, published, section, updated_at)
      VALUES ('moc', 'MOC', ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET
        content = excluded.content,
        properties = excluded.properties,
        updated_at = CURRENT_TIMESTAMP
    `).run(md, JSON.stringify(props), section)
  } catch (e) {
    console.error('MOC regeneration failed:', e.message)
  }
}

module.exports = { parseNote, pathError, PUBLIC_SQL, isPublicNote, regenerateRootMoc }
