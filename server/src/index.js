require('dotenv').config()
const express = require('express')
const session = require('express-session')
const SQLiteStore = require('connect-sqlite3')(session)
const path = require('path')
const fs = require('fs')

const authRoutes = require('./routes/auth')
const articleRoutes = require('./routes/articles')
const kanbanRoutes = require('./routes/kanban')
const uploadRoutes = require('./routes/uploads')
const { requireAuth } = require('./middleware/auth')

const app = express()
const PORT = process.env.PORT || 3000
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data')
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true }))

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.COOKIE_SECURE === 'true',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}))

// Portfolio statique
app.use(express.static(path.join(__dirname, '../../public')))

// Uploads (images des articles) — auth requise
app.use('/uploads', requireAuth, express.static(UPLOADS_DIR))

// Admin — login sans auth, tout le reste protégé
const adminDist = path.join(__dirname, '../../admin/dist')
app.get('/admin/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/admin')
  res.sendFile(path.join(adminDist, 'login.html'))
})
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(adminDist, 'dashboard.html')))
app.get('/admin/editor', requireAuth, (req, res) => res.sendFile(path.join(adminDist, 'editor.html')))
app.get('/admin/kanban', requireAuth, (req, res) => res.sendFile(path.join(adminDist, 'kanban.html')))
app.use('/admin', express.static(adminDist))

// API
app.use('/api/auth', authRoutes)
app.use('/api/articles', articleRoutes)
app.use('/api/kanban', requireAuth, kanbanRoutes)
app.use('/api/uploads', uploadRoutes)

// Blog pages publiques
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, '../../public/blog/index.html')))
app.get('/blog/:slug', (req, res) => res.sendFile(path.join(__dirname, '../../public/blog/article.html')))

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
