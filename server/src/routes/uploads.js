const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { requireAuth } = require('../middleware/auth')

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../../uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  }
})

const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'])

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!file.mimetype.startsWith('image/') || !ALLOWED_IMAGE_EXTS.has(ext)) {
      return cb(new Error('Images uniquement (jpg, png, gif, webp, avif)'))
    }
    cb(null, true)
  }
})

const router = express.Router()
router.use(requireAuth)

router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
  res.json({ url: `/uploads/${req.file.filename}` })
})

module.exports = router
