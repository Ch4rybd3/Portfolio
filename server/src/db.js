require('dotenv').config()
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'blog.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    cover_image TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kanban_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS kanban_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_id INTEGER NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// Colonnes kanban par défaut
const { count } = db.prepare('SELECT COUNT(*) as count FROM kanban_columns').get()
if (count === 0) {
  const ins = db.prepare('INSERT INTO kanban_columns (title, position) VALUES (?, ?)')
  ;[['Idées', 0], ['En cours', 1], ['À réviser', 2], ['Publié', 3]].forEach(([t, p]) => ins.run(t, p))
}

// Migration: add tags column if it doesn't exist yet
try { db.exec(`ALTER TABLE articles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`) } catch {}

// Migration: add section column to docs_notes (kb | remora)
try { db.exec(`ALTER TABLE docs_notes ADD COLUMN section TEXT NOT NULL DEFAULT 'kb'`) } catch {}

// Docs knowledge base
db.exec(`
  CREATE TABLE IF NOT EXISTS docs_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL DEFAULT 'Untitled',
    content    TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}',
    published  INTEGER NOT NULL DEFAULT 1,
    section    TEXT NOT NULL DEFAULT 'kb',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// Docs templates (admin only, stored server-side)
db.exec(`
  CREATE TABLE IF NOT EXISTS docs_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    content    TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    properties TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// Migration: add properties column to docs_templates (Obsidian-like metadata)
try { db.exec(`ALTER TABLE docs_templates ADD COLUMN properties TEXT NOT NULL DEFAULT '{}'`) } catch {}

// Seed KB welcome note
db.prepare(`
  INSERT INTO docs_notes (path, title, content, properties, section)
  VALUES ('welcome', 'Welcome', ?, '{"tags":["meta"]}', 'kb')
  ON CONFLICT(path) DO NOTHING
`).run(`# Welcome to the Knowledge Base

This is my public knowledge base covering **DFIR**, **CTI**, **SOC**, **OSINT**, red team and more.

Browse the folder tree on the left, or use the search bar to find a specific note.

## Conventions

- \`[[Note Title]]\` links connect related notes
- Code blocks include the language for syntax highlighting
- Callout blocks highlight important information:

> [!TIP]
> This knowledge base is continuously updated. Contributions and corrections are welcome via GitHub.

> [!NOTE]
> All techniques described here are for **defensive and educational** purposes.
`)

// Seed Remora welcome note
db.prepare(`
  INSERT INTO docs_notes (path, title, content, properties, section)
  VALUES ('getting-started', 'Getting Started', ?, '{"tags":["overview"]}', 'remora')
  ON CONFLICT(path) DO NOTHING
`).run(`# Remora — Getting Started

**Remora** is a DFIR case management platform built to cover the full investigative lifecycle.

## What is Remora?

Remora lets you manage cases, follow structured playbooks, process and tag artifacts, maintain chain of custody, take structured notes, and generate reports — all from one place.

Designed from first principles to match how analysts actually work: fast triage, flexible note-taking, and deep artifact integration without forcing context switches between tools.

## Documentation

This section covers the Remora documentation. Use the tree on the left to navigate.

> [!NOTE]
> Remora is currently in early development. This documentation is updated alongside the project.
`)

// Site configuration table
db.exec(`
  CREATE TABLE IF NOT EXISTS site_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// Seed default config if missing
const DEFAULTS = {
  'portfolio.now': [
    { icon: 'fa-solid fa-code',      text: 'Building **Remora** — DFIR case management platform' },
    { icon: 'fa-solid fa-briefcase', text: 'Consulting **SOC / DFIR / CTI** at Amaris Consulting' }
  ],
  'portfolio.stats': [
    { value: '6+', label: 'Years in IT & Security' },
    { value: '4',  label: 'OSS Projects in Dev' },
    { value: '2',  label: 'Countries Worked In' },
    { value: '3',  label: 'Certifications' }
  ],
  'portfolio.skills': [
    { title: 'DFIR', tools: [
      { name: 'Volatility3', hl: true }, { name: 'KAPE', hl: true }, { name: 'EZ Tools', hl: true },
      { name: 'Velociraptor' }, { name: 'DFIR-IRIS' }, { name: 'FTK Imager' }, { name: 'AXIOM' },
      { name: 'Timeline Explorer' }, { name: 'avml' }, { name: 'dwarf2json' }, { name: 'UAC' }, { name: 'Autopsy' }
    ]},
    { title: 'SOC & Detection', tools: [
      { name: 'SentinelOne', hl: true }, { name: 'HarfangLab', hl: true }, { name: 'ELK Stack', hl: true },
      { name: 'Microsoft Sentinel' }, { name: 'Varonis' }, { name: 'Zscaler' }, { name: 'Wallix' },
      { name: 'McAfee' }, { name: 'Carbon Black' }, { name: 'MITRE ATT&CK' }
    ]},
    { title: 'CTI & OSINT', tools: [
      { name: 'MITRE ATT&CK', hl: true }, { name: 'XMCO' }, { name: 'Cybelangel' }, { name: 'OSINT' },
      { name: 'IOC Analysis' }, { name: 'Threat Actor Tracking' }, { name: 'Attack Surface Mapping' },
      { name: 'Dark Web Monitoring' }, { name: 'Maltego' }
    ]},
    { title: 'Development & Scripting', tools: [
      { name: 'Python', hl: true }, { name: 'PowerShell', hl: true }, { name: 'Rust' }, { name: 'Bash' },
      { name: 'Docker' }, { name: 'Git' }, { name: 'REST APIs' }, { name: 'SQLite' },
      { name: 'Linux' }, { name: 'Windows' }
    ]}
  ],
  'portfolio.certifications': [
    { name: 'CompTIA Security+',                    year: '2023',                    wip: false },
    { name: 'ITIL4 Foundation',                     year: '2021',                    wip: false },
    { name: 'HarfangLab Incident Response',         year: '2024',                    wip: false },
    { name: 'Varonis Certification',                year: 'In progress',             wip: true  },
    { name: 'CDSA — Certified Defensive Security Analyst', year: 'In progress · HackTheBox', wip: true }
  ],
  'portfolio.career': [
    {
      active: true, dateRange: '2025 — now', location: 'Lyon, FR',
      role: 'SOC / DFIR / CTI Consultant', company: 'AMARIS CONSULTING',
      bullets: [
        '**SOC Operations (RUN):** Threat hunting and alert triage — SentinelOne, Varonis, Microsoft Defender for Office, XMCO (CTI). Maintenance of Wallix bastions, Zscaler proxy and ELK data lake.',
        '**SOC Engineering (BUILD):** DFIR-IRIS deployment, DFIR tooling and process setup, SentinelOne workflow automation via Python & API, detection rule authoring, out-of-band forensic workstation setup.',
        '**DFIR Training:** Technical DFIR training for the SOC team, workshops for international teams, CTF & challenge design, malware development for simulations, playbook and knowledge base documentation.'
      ],
      stack: ['sentinelone', 'dfir-iris', 'volatility3', 'elk', 'python']
    },
    {
      active: false, dateRange: '2023 — 2024', location: 'Montréal, CA', duration: '1 year',
      role: 'Cybersecurity Consultant', company: 'FORMIND CANADA · MSSP',
      bullets: [
        'SOC operations on Canadian timezone covering Azure, AWS, HarfangLab, ELK, ESET, Carbon Black.',
        'Detection rule creation, fine-tuning and whitelisting. SOC as Code GitHub issue handling.',
        'OSINT missions and attack surface mapping. Incident response. Service Delivery Management for multiple clients.',
        'Threat actor tracking and pentesting + reporting. Built a data breach detection branch to proactively notify unreported victims.'
      ],
      stack: ['harfanglab', 'azure', 'aws', 'elk', 'carbon black']
    },
    {
      active: false, dateRange: '2023', location: 'Montréal, CA', duration: '6 months',
      role: 'Cybersecurity Consultant', company: 'ZENIKA CANADA',
      bullets: [
        'Internal offer development and pre-sales. Active participation in cybersecurity and GenAI communities.',
        'Achieved CompTIA Security+ and CBBH certifications. GCP cloud training.',
        'Prepared and delivered WAQ 2023 talk on phishing and social engineering.',
        'Self-directed study of physical pentest, red team exercises and common web attack patterns (XSS, SQLi, Burp Suite, Metasploit, Aircrack-ng).'
      ],
      stack: ['sec+', 'cbbh', 'gcp', 'pentest']
    },
    {
      active: false, dateRange: '2020 — 2022', location: 'Bron, FR', duration: '2 years',
      role: 'Cybersecurity / SOC Analyst', company: 'CYBERPROTECT',
      bullets: [
        'SOC analysis for diverse client environments via SIEM and EDR. Firewall, IDS and security device management.',
        'Process documentation and knowledge base development. Key account analyst for several major clients.',
        'Vulnerability scanning, penetration test participation, dynamic malware analysis, L1/L2 support.',
        'ITIL4 Foundation certification. NSE4 training (Fortinet).'
      ],
      stack: ['fortinet', 'palo alto', 'elk', 'mcafee']
    },
    {
      active: false, dateRange: '2019 — 2020', location: 'Lissieu, FR', duration: 'Work-study',
      role: 'Project Lead — Cybersecurity', company: 'BYBLOS GROUP',
      bullets: [
        'Built a USB-based compliance audit tool enabling security guards to assess workstations during physical rounds.',
        'PowerShell scripting for data collection and compliance assessment. Based on ISO 27002 and 42 ANSSI best practices.'
      ],
      stack: ['powershell', 'iso27002', 'python']
    },
    {
      active: false, dateRange: '2018 — 2019', location: 'Saint-Étienne, FR', duration: 'Work-study',
      role: 'SysAdmin', company: 'GIBAUD — ÖSSUR GROUP',
      bullets: [
        'L1 helpdesk, Active Directory management (accounts, GPOs), weekly English-language meetings with international HQ.',
        'Malicious email analysis. Led Windows 10 fleet deployment project. Hardware replacement.'
      ],
      stack: ['active directory', 'cisco', 'windows']
    }
  ],
  'projects.oss': [
    {
      featured: true, num: '01', category: 'DFIR PLATFORM', status: 'wip',
      name: 'Remora', description: 'A DFIR case management platform built to cover the full investigative lifecycle. Manage cases, follow structured playbooks, process and tag artifacts, maintain chain of custody, take structured notes, and generate reports automatically — all from one place.\n\nDesigned from first principles to match how analysts actually work: fast triage, flexible note-taking, and deep artifact integration without forcing you out of your terminal.',
      annotation: 'Building Remora because nothing out there truly integrates the full DFIR workflow — from acquisition to final report — without forcing context switches between 5 different tools.',
      stack: [{ name: 'Rust', hl: true }, { name: 'Python', hl: true }, { name: 'SQLite' }, { name: 'REST API' }, { name: 'CLI' }],
      milestones: [
        { text: 'Concept & architecture defined', done: true },
        { text: 'Repository structure & initial setup', done: true },
        { text: 'Case management core (create / assign / close)', done: false },
        { text: 'Artifact ingestion & tagging pipeline', done: false },
        { text: 'Playbook engine with step tracking', done: false },
        { text: 'Chain of custody ledger', done: false },
        { text: 'Report generator (PDF / Markdown)', done: false }
      ],
      meta: [{ label: 'Type', value: 'OSS · DFIR Platform' }, { label: 'Lang', value: 'Rust / Python' }, { label: 'Status', value: 'Early Dev' }, { label: 'License', value: 'MIT' }],
      github: 'https://github.com/Ch4rybd3/Remora'
    },
    {
      featured: false, num: '02', category: 'MALDEV', status: 'active',
      name: 'Marianas', description: 'Malware development repository for education, CTFs, crisis simulations and workshops. Ransomwares, C2 frameworks, payload generators, loaders and more — all for controlled, ethical use in security training.',
      annotation: 'All samples are for authorized use only. Designed for internal training and controlled lab environments.',
      stack: [{ name: 'python' }, { name: 'rust' }, { name: 'c' }, { name: 'maldev' }, { name: 'c2' }, { name: 'education' }],
      milestones: [],
      meta: [],
      github: 'https://github.com/Ch4rybd3/Marianas'
    },
    {
      featured: false, num: '03', category: 'DFIR TOOLING', status: 'wip',
      name: 'Kaluga', description: 'A DFIR-tailored container environment inspired by Exegol. Spins up isolated, reproducible containers on the fly for each incident response, keeping your host ecosystem clean across engagements.',
      annotation: 'Born from the need to keep my DFIR workstation clean between cases. Each engagement gets a fresh, scoped container.',
      stack: [{ name: 'docker' }, { name: 'shell' }, { name: 'dfir' }, { name: 'containers' }, { name: 'isolation' }],
      milestones: [],
      meta: [],
      github: 'https://github.com/Ch4rybd3/Kaluga'
    },
    {
      featured: false, num: '04', category: 'KNOWLEDGE BASE', status: 'active',
      name: 'Abzu', description: 'A public Obsidian vault documenting everything I learn across my cybersecurity journey — DFIR techniques, CTI methods, SOC workflows, tool notes, and lab writeups. Clone it, open it in Obsidian, explore freely.',
      annotation: 'Named after the Sumerian primordial waters of knowledge. All that I know, structured and shared.',
      stack: [{ name: 'obsidian' }, { name: 'markdown' }, { name: 'dfir' }, { name: 'cti' }, { name: 'knowledge' }],
      milestones: [],
      meta: [],
      github: 'https://github.com/Ch4rybd3/Abzu'
    }
  ],
  'projects.side': [
    {
      category: 'PERSONAL · GAMING', status: 'maintained',
      name: 'Retroarch-GitHub_Sync', description: 'A GitHub-synced save-state system for retro gaming across multiple machines — no Syncthing, no cloud subscriptions. Built for seamless Pokémon runs across different computers.',
      annotation: 'Started because I could not keep save files in sync between my desktop and laptop without some cursed Syncthing setup. Why not use git?',
      stack: ['shell', 'git', 'retroarch', 'automation'],
      github: 'https://github.com/Ch4rybd3/Retroarch-GitHub_Sync'
    },
    {
      category: 'PERSONAL · AUTOMATION', status: 'maintained',
      name: 'PokeMMO-NoMoreLostShinies', description: 'A Python companion for shiny hunting in PokeMMO that watches for rare encounters and alerts you — because shinies should not die to recoil damage while you are looking away.',
      annotation: 'Lost a shiny Ralts to recoil once. Never again. Built in an evening out of spite and it has been working perfectly since.',
      stack: ['python', 'opencv', 'pokemmo', 'screen-capture'],
      github: 'https://github.com/Ch4rybd3/PokeMMO-NoMoreLostShinies'
    }
  ],
  'projects.talks': [
    {
      conf: 'WAQ\nQuébec', year: '2023', status: 'delivered',
      eyebrow: 'CONFERENCE TALK · WEB À QUÉBEC 2023',
      title: '"Phishing and Social Engineering — Ever been in a hacker\'s mind?"',
      abstract: 'A walk through the mind of an attacker — from target selection to payload delivery. Rather than a classic awareness lecture, I placed the audience directly inside the attacker\'s perspective using reverse psychology, making the threat viscerally real rather than abstract.\n\nThe talk covered the full phishing kill chain: initial recon, pretexting, email spoofing and infrastructure, payload delivery, evasion, and post-click actions. I demonstrated live tooling (GoPhish, Evilginx, custom pretexts) in a controlled setup.',
      annotation: 'The goal was to make people uncomfortable in a productive way. Not "here are phishing red flags" but "here is exactly how I would phish you, step by step, right now."',
      topics: ['Phishing', 'Social Engineering', 'Security Awareness', 'Red Team', 'GoPhish', 'Evilginx'],
      location: 'Québec City, Canada', date: 'WAQ 2023 · April 2023',
      attendees: '~150 attendees', language: 'French'
    }
  ],
  'projects.community': [
    {
      icon: 'fa-solid fa-chalkboard-user', category: 'Training', title: 'DFIR Training for SOC Teams',
      description: 'Designed and delivered technical DFIR training sessions for SOC analysts — covering memory forensics, disk triage, artifact analysis, and incident timeline reconstruction.',
      items: ['Memory acquisition & Volatility3 deep-dive', 'Windows artifact collection (KAPE, EZ Tools)', 'Timeline analysis & evidence correlation', 'DFIR-IRIS case management walkthrough', 'Hands-on IR playbook exercises'],
      meta: 'Amaris Consulting · 2025 · Lyon / Remote'
    },
    {
      icon: 'fa-solid fa-flag', category: 'CTF Design', title: 'Challenge & CTF Authoring',
      description: 'Designed CTF challenges and lab scenarios for internal workshops, covering forensics, reverse engineering, and attacker simulation.',
      items: ['DFIR forensics challenges (memory, disk, network)', 'Attacker simulation scenarios for blue team training', 'Crisis simulation exercises with realistic malware samples', 'IR tabletop exercises with decision-point branching'],
      meta: 'Amaris Consulting · 2025 · Lyon'
    },
    {
      icon: 'fa-solid fa-virus', category: 'Red Team Support', title: 'Malware Simulations for Training',
      description: 'Developed custom malware samples for use in crisis simulation exercises and SOC training environments.',
      items: ['Ransomware simulator (safe, no real encryption)', 'C2 beacon for IR triage training', 'Payload loaders for detection rule testing', 'YARA rule coverage validation suite'],
      meta: 'Internal use · Amaris Consulting · 2025'
    },
    {
      icon: 'fa-solid fa-book-open', category: 'Open Source', title: 'Public Knowledge & OSS',
      description: 'Public resources for the community — from the Abzu knowledge vault to blog articles, tool documentation, and process templates.',
      items: ['Abzu — public Obsidian vault (DFIR / SOC / CTI notes)', 'Blog articles on DFIR techniques & tool usage', 'IR playbook templates & documentation', 'Detection rules & DFIR tooling open-sourced via GitHub'],
      meta: 'Public · github.com/Ch4rybd3 · Ongoing'
    },
    {
      icon: 'fa-solid fa-magnifying-glass-chart', category: 'CTI', title: 'Data Breach Detection Branch',
      description: 'At Formind Canada, built a proactive data breach detection capability from scratch — monitoring dark web sources, paste sites, and leak channels.',
      items: ['Dark web monitoring pipeline', 'Automated correlation & victim identification', 'Responsible disclosure process design', 'IOC extraction & threat actor profiling'],
      meta: 'Formind Canada · Montréal · 2023–2024'
    },
    {
      icon: 'fa-solid fa-sitemap', category: 'Documentation', title: 'SOC Process & Playbook Docs',
      description: 'Built internal knowledge bases and SOC runbooks across multiple employers — structured documentation for alert handling, IR procedures, and tool onboarding.',
      items: ['Incident response playbooks (ransomware, BEC, insider)', 'Alert triage procedures & escalation trees', 'Tool onboarding docs (SentinelOne, DFIR-IRIS, Velociraptor)', 'Post-incident report templates'],
      meta: 'Amaris · Formind · Cyberprotect · 2020–2025'
    }
  ]
}

// ── Migration: HTML → Markdown dans les données existantes ──────────────────
function htmlToMd(str) {
  if (!str || !str.includes('<')) return str
  return str
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

try {
  // portfolio.now — champ text
  const nowRow = db.prepare("SELECT value FROM site_config WHERE key = 'portfolio.now'").get()
  if (nowRow) {
    const items = JSON.parse(nowRow.value)
    const migrated = items.map(it => ({ ...it, text: htmlToMd(it.text || '') }))
    db.prepare("UPDATE site_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'portfolio.now'")
      .run(JSON.stringify(migrated))
  }

  // portfolio.career — bullets de chaque entrée
  const careerRow = db.prepare("SELECT value FROM site_config WHERE key = 'portfolio.career'").get()
  if (careerRow) {
    const entries = JSON.parse(careerRow.value)
    const migrated = entries.map(e => ({
      ...e,
      bullets: (e.bullets || []).map(b => htmlToMd(b))
    }))
    db.prepare("UPDATE site_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'portfolio.career'")
      .run(JSON.stringify(migrated))
  }
} catch (e) { console.error('Config migration error:', e.message) }
// ────────────────────────────────────────────────────────────────────────────

const insertConfig = db.prepare(`
  INSERT INTO site_config (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO NOTHING
`)
for (const [key, val] of Object.entries(DEFAULTS)) {
  insertConfig.run(key, JSON.stringify(val))
}

module.exports = db
