function requireAuth(req, res, next) {
  if (req.session?.userId) return next()
  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autorisé' })
  }
  res.redirect('/admin/login')
}

module.exports = { requireAuth }
