const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'papernest.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
  } else {
    console.log(`Connected to SQLite database at ${DB_FILE}`);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      filesize INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
});

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'papernest_dev_session_secret_12345';

app.use(session({
  name: 'papernest_session',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedExt = path.extname(file.originalname).slice(0, 10);
    cb(null, `${uniqueSuffix}${sanitizedExt}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

app.get('/id*document.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'document.html'));
});

app.get('/document.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'document.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'document.html'));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ authenticated: false });
  }
  db.get('SELECT id, email, created_at FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) {
      req.session.destroy();
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user });
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length < 3 || !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [normalizedEmail, passwordHash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
          }
          return res.status(500).json({ error: 'Database error during registration.' });
        }

        req.session.userId = this.lastID;
        req.session.userEmail = normalizedEmail;

        res.status(201).json({
          message: 'Account created successfully.',
          user: { id: this.lastID, email: normalizedEmail }
        });
      }
    );
  } catch (hashError) {
    res.status(500).json({ error: 'Internal server error processing credentials.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error during login.' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      req.session.userId = user.id;
      req.session.userEmail = user.email;

      res.json({
        message: 'Signed in successfully.',
        user: { id: user.id, email: user.email }
      });
    } catch (compareError) {
      res.status(500).json({ error: 'Internal error validating credentials.' });
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error logging out.' });
    }
    res.clearCookie('papernest_session');
    res.json({ message: 'Logged out successfully.' });
  });
});

app.get('/api/documents', requireAuth, (req, res) => {
  if (req.query.id) {
    const cleanedId = parseInt(req.query.id.toString().replace(/["']/g, ''), 10);
    if (isNaN(cleanedId) || cleanedId !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
  }

  const targetUserId = req.session.userId;

  db.all(
    'SELECT id, filename, filesize, mimetype, created_at FROM documents WHERE user_id = ? ORDER BY created_at DESC',
    [targetUserId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve documents.' });
      }
      res.json(rows || []);
    }
  );
});

app.post('/api/documents/upload', requireAuth, upload.single('document'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const currentUserId = req.session.userId;
  const originalName = req.file.originalname;
  const storedName = req.file.filename;
  const filePath = req.file.path;
  const mimeType = req.file.mimetype || 'application/octet-stream';
  const fileSize = req.file.size;

  db.run(
    `INSERT INTO documents (user_id, filename, stored_name, filepath, mimetype, filesize)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [currentUserId, originalName, storedName, filePath, mimeType, fileSize],
    function (err) {
      if (err) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(500).json({ error: 'Failed to save document metadata.' });
      }

      res.status(201).json({
        message: 'File uploaded successfully',
        document: {
          id: this.lastID,
          filename: originalName,
          filesize: fileSize,
          created_at: new Date().toISOString()
        }
      });
    }
  );
});

app.get('/api/documents/:id/preview', requireAuth, (req, res) => {
  const docId = parseInt(req.params.id, 10);

  if (isNaN(docId)) {
    return res.status(400).json({ error: 'Invalid document ID.' });
  }

  db.get('SELECT * FROM documents WHERE id = ?', [docId], (err, doc) => {
    if (err) return res.status(500).json({ error: 'Database query failed.' });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    if (doc.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (!fs.existsSync(doc.filepath)) {
      return res.status(404).json({ error: 'Stored document file not found on disk.' });
    }

    res.setHeader('Content-Type', doc.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
    return res.sendFile(path.resolve(doc.filepath));
  });
});

app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const docId = parseInt(req.params.id, 10);

  if (isNaN(docId)) {
    return res.status(400).json({ error: 'Invalid document ID.' });
  }

  db.get('SELECT * FROM documents WHERE id = ?', [docId], (err, doc) => {
    if (err) return res.status(500).json({ error: 'Database query failed.' });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    if (doc.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (!fs.existsSync(doc.filepath)) {
      return res.status(404).json({ error: 'Stored document file not found on disk.' });
    }

    return res.download(path.resolve(doc.filepath), doc.filename);
  });
});

app.delete('/api/documents/:id', requireAuth, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const currentUserId = req.session.userId;

  if (isNaN(docId)) {
    return res.status(400).json({ error: 'Invalid document ID.' });
  }

  db.get('SELECT * FROM documents WHERE id = ? AND user_id = ?', [docId, currentUserId], (err, doc) => {
    if (err) return res.status(500).json({ error: 'Database query failed.' });
    if (!doc) {
      return res.status(403).json({ error: 'Access denied. You do not own this document.' });
    }

    db.run('DELETE FROM documents WHERE id = ?', [docId], (deleteErr) => {
      if (deleteErr) {
        return res.status(500).json({ error: 'Failed to delete document from database.' });
      }

      try {
        if (fs.existsSync(doc.filepath)) {
          fs.unlinkSync(doc.filepath);
        }
      } catch (fileErr) {}

      res.json({ message: 'Document deleted successfully.' });
    });
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PaperNest server running at http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
