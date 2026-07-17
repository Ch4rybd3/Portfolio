/* ── Limitation des tentatives de connexion (anti brute-force) ──
   Fenêtre glissante en mémoire, par IP : seules les tentatives ÉCHOUÉES
   comptent ; un login réussi remet le compteur à zéro.
   L'IP réelle vient de CF-Connecting-IP via nginx (real_ip) + trust proxy. */

const WINDOW_MS    = 15 * 60 * 1000
const MAX_FAILURES = 5

const failures = new Map() // ip -> { count, first }

// Purge périodique des entrées expirées (unref: ne bloque pas l'arrêt du process)
setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of failures) {
    if (now - rec.first > WINDOW_MS) failures.delete(ip)
  }
}, 10 * 60 * 1000).unref()

function loginRateLimit(req, res, next) {
  const rec = failures.get(req.ip)
  if (rec && Date.now() - rec.first > WINDOW_MS) { failures.delete(req.ip); return next() }
  if (rec && rec.count >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((rec.first + WINDOW_MS - Date.now()) / 1000))
    res.setHeader('Retry-After', retryAfter)
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} min.` })
  }
  next()
}

function recordLoginFailure(req) {
  const now = Date.now()
  const rec = failures.get(req.ip)
  if (!rec || now - rec.first > WINDOW_MS) failures.set(req.ip, { count: 1, first: now })
  else rec.count++
}

function clearLoginFailures(req) {
  failures.delete(req.ip)
}

module.exports = { loginRateLimit, recordLoginFailure, clearLoginFailures }
