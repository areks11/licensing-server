const express = require('express');
const { Client } = require('pg'); // ZMIANA: Importujemy nową bibliotekę
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json());

// --- POŁĄCZENIE Z BAZĄ DANYCH POSTGRES ---
const db = new Client({
  // WAŻNE: Wklejony Twój unikalny adres z Render
  connectionString: "postgresql://areks11_ttl_database_user:5gtfGoIynzKUqbLDyrOCHzkI3T0E82Em@dpg-d2s10lbe5dus73clmjtg-a/areks11_ttl_database", 
  ssl: {
    rejectUnauthorized: false
  }
});

db.connect()
  .then(() => console.log('Połączono z bazą danych PostgreSQL.'))
  .then(() => {
    // Upewniamy się, że tabela na licencje istnieje
    return db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key TEXT NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      )
    `);
  })
  .then(() => console.log('Tabela "licenses" jest gotowa.'))
  .catch(err => console.error('Błąd połączenia lub tworzenia tabeli:', err.stack));


// Endpoint do generowania kluczy na DNI
app.get('/generate-license/days/:value', async (req, res) => {
  const days = parseInt(req.params.value, 10);
  if (isNaN(days)) return res.status(400).json({ error: 'Nieprawidłowa liczba dni' });

  const expirationDate = Date.now() + (days * 24 * 60 * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${days} dni`);
});

// Endpoint do generowania kluczy na GODZINY
app.get('/generate-license/hours/:value', async (req, res) => {
  const hours = parseInt(req.params.value, 10);
  if (isNaN(hours)) return res.status(400).json({ error: 'Nieprawidłowa liczba godzin' });

  const expirationDate = Date.now() + (hours * 60 * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${hours} godzin`);
});

// Endpoint do generowania kluczy na MINUTY
app.get('/generate-license/minutes/:value', async (req, res) => {
  const minutes = parseInt(req.params.value, 10);
  if (isNaN(minutes)) return res.status(400).json({ error: 'Nieprawidłowa liczba minut' });

  const expirationDate = Date.now() + (minutes * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${minutes} minut`);
});

// Wspólna funkcja pomocnicza do generowania i zapisywania kluczy
async function generateAndSaveKey(res, expirationDate, durationText) {
  const newKey = crypto.randomBytes(16).toString('hex');
  const sql = `INSERT INTO licenses (license_key, expires_at) VALUES ($1, $2)`;
  
  try {
    await db.query(sql, [newKey, expirationDate]);
    console.log(`Wygenerowano i zapisano nowy klucz: ${newKey}`);
    res.json({
      message: `Wygenerowano nowy klucz licencyjny ważny przez ${durationText}.`,
      key: newKey
    });
  } catch (err) {
    console.error('Błąd podczas zapisywania klucza do bazy:', err.message);
    res.status(500).json({ error: 'Błąd serwera podczas generowania klucza' });
  }
}

// Endpoint do weryfikacji klucza licencyjnego
app.post('/verify-license', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ valid: false, message: 'Nie dostarczono klucza licencyjnego.' });
  }

  const sql = `SELECT * FROM licenses WHERE license_key = $1`;

  try {
    const { rows } = await db.query(sql, [key]);
    const row = rows[0];

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

    res.json({
      valid: true,
      message: 'Licencja jest aktywna i poprawna.',
      expires_at: new Date(parseInt(row.expires_at)).toISOString()
    });
  } catch (err) {
    console.error('Błąd podczas sprawdzania klucza:', err.message);
    res.status(500).json({ valid: false, message: 'Błąd serwera.' });
  }
});

app.get('/', (req, res) => {
  res.send('Serwer licencyjny działa i jest połączony z bazą danych PostgreSQL!');
});

app.listen(port, () => {
  console.log(`Serwer licencyjny nasłuchuje na http://localhost:${port}`);
});