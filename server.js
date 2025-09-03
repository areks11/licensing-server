const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001; // Hosting ustawi port w zmiennej środowiskowej PORT
const dbFile = './licenses.db';

// Middleware do odczytywania JSON z ciała zapytania
app.use(express.json());

const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    return console.error('Błąd podczas łączenia z bazą danych:', err.message);
  }
  console.log('Połączono z bazą danych SQLite.');
  
  db.run(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `, (err) => {
    if (err) return console.error('Błąd podczas tworzenia tabeli:', err.message);
    console.log('Tabela "licenses" jest gotowa.');
  });
});

// Endpoint do generowania nowego klucza licencyjnego
app.get('/generate-license/:days', (req, res) => {
  const days = parseInt(req.params.days, 10);
  if (isNaN(days) || days <= 0) {
    return res.status(400).json({ error: 'Nieprawidłowa liczba dni' });
  }

  const newKey = crypto.randomBytes(16).toString('hex');
  const expirationDate = Date.now() + (days * 24 * 60 * 60 * 1000);

  const sql = `INSERT INTO licenses (license_key, expires_at) VALUES (?, ?)`;
  
  db.run(sql, [newKey, expirationDate], function(err) {
    if (err) {
      console.error('Błąd podczas zapisywania klucza do bazy:', err.message);
      return res.status(500).json({ error: 'Błąd serwera podczas generowania klucza' });
    }
    
    console.log(`Wygenerowano i zapisano nowy klucz: ${newKey}`);
    res.json({
      message: `Wygenerowano nowy klucz licencyjny ważny przez ${days} dni.`,
      key: newKey
    });
  });
});

// === NOWY FRAGMENT KODU ===
// Endpoint do weryfikacji klucza licencyjnego
app.post('/verify-license', (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ valid: false, message: 'Nie dostarczono klucza licencyjnego.' });
  }

  const sql = `SELECT * FROM licenses WHERE license_key = ?`;

  db.get(sql, [key], (err, row) => {
    if (err) {
      console.error('Błąd podczas sprawdzania klucza:', err.message);
      return res.status(500).json({ valid: false, message: 'Błąd serwera.' });
    }

    if (!row) {
      return res.status(404).json({ valid: false, message: 'Klucz licencyjny nie został znaleziony.' });
    }

    if (row.status !== 'active') {
        return res.status(403).json({ valid: false, message: 'Licencja nie jest aktywna.' });
    }

    const now = Date.now();
    if (row.expires_at < now) {
      return res.status(403).json({ valid: false, message: 'Licencja wygasła.' });
    }

    // Jeśli wszystko się zgadza, licencja jest ważna
    res.json({
      valid: true,
      message: 'Licencja jest aktywna i poprawna.',
      expires_at: new Date(row.expires_at).toISOString()
    });
  });
});
// === KONIEC NOWEGO FRAGMENTU KODU ===

app.get('/', (req, res) => {
  res.send('Serwer licencyjny działa i jest połączony z bazą danych!');
});

app.listen(port, () => {
  console.log(`Serwer licencyjny nasłuchuje na http://localhost:${port}`);
});