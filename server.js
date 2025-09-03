const express = require('express');
const { Client } = require('pg');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json());

// Wybierz connection string: ENV (Render) albo fallback (External)
const CONNECTION_STRING = process.env.DATABASE_URL || "postgresql://areks11_ttl_database_user:5gtfGoIynzKUqbLDyrOCHzkI3T0E82Em@dpg-d2s10lbe5dus73clmjtg-a.postgres.render.com/areks11_ttl_database";

// Bezpieczny log (tylko host, bez hasła), pomoże sprawdzić czy używa ENV czy fallbacku
try {
  const { hostname } = new URL(CONNECTION_STRING);
  console.log('[BOOT] DB host:', hostname, process.env.DATABASE_URL ? '(ENV)' : '(fallback EXTERNAL)');
} catch (e) {
  console.warn('[BOOT] Could not parse DB URL');
}

const db = new Client({
  connectionString: CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false
  }
});


db.connect()
  .then(() => console.log('Połączono z bazą danych PostgreSQL.'))
  .then(() => {
    return db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key TEXT NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        device_id TEXT NULL
      )
    `);
  })
  .then(() => console.log('Tabela "licenses" jest gotowa.'))
  .catch(err => console.error('Błąd połączenia lub tworzenia tabeli:', err.stack));

// Endpointy do generowania kluczy
app.get('/generate-license/days/:value', async (req, res) => {
  const days = parseInt(req.params.value, 10);
  if (isNaN(days)) return res.status(400).json({ error: 'Nieprawidłowa liczba dni' });
  const expirationDate = Date.now() + (days * 24 * 60 * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${days} dni`);
});
app.get('/generate-license/hours/:value', async (req, res) => {
  const hours = parseInt(req.params.value, 10);
  if (isNaN(hours)) return res.status(400).json({ error: 'Nieprawidłowa liczba godzin' });
  const expirationDate = Date.now() + (hours * 60 * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${hours} godzin`);
});
app.get('/generate-license/minutes/:value', async (req, res) => {
  const minutes = parseInt(req.params.value, 10);
  if (isNaN(minutes)) return res.status(400).json({ error: 'Nieprawidłowa liczba minut' });
  const expirationDate = Date.now() + (minutes * 60 * 1000);
  generateAndSaveKey(res, expirationDate, `${minutes} minut`);
});

async function generateAndSaveKey(res, expirationDate, durationText) {
  const newKey = crypto.randomBytes(16).toString('hex');
  const sql = `INSERT INTO licenses (license_key, expires_at) VALUES ($1, $2)`;
  try {
    await db.query(sql, [newKey, expirationDate]);
    console.log(`Wygenerowano i zapisano nowy klucz: ${newKey}`);
    res.json({ message: `Wygenerowano nowy klucz licencyjny ważny przez ${durationText}.`, key: newKey });
  } catch (err) {
    console.error('Błąd podczas zapisywania klucza do bazy:', err.message);
    res.status(500).json({ error: 'Błąd serwera podczas generowania klucza' });
  }
}

// Endpoint do weryfikacji klucza licencyjnego z obsługą Device ID
app.post('/verify-license', async (req, res) => {
  const { key, deviceId } = req.body;
  if (!key || !deviceId) {
    return res.status(400).json({ valid: false, message: 'Nie dostarczono klucza lub ID urządzenia.' });
  }

  const sqlSelect = `SELECT * FROM licenses WHERE license_key = $1`;

  try {
    // LOG: co przyszło
    console.log('[VERIFY] key=', key, ' incomingDeviceId=', deviceId);

    const { rows } = await db.query(sqlSelect, [key]);
    const row = rows[0];

    if (!row) {
      console.warn('[VERIFY] key not found');
      return res.status(404).json({ valid: false, message: 'Klucz licencyjny nie został znaleziony.' });
    }

    // LOG: co mamy w bazie
    console.log('[VERIFY] dbRow=', {
      status: row.status,
      expires_at: row.expires_at,
      device_id: row.device_id,
      device_id_type: typeof row.device_id
    });

    if (row.status !== 'active') {
      return res.status(403).json({ valid: false, message: 'Licencja nie jest aktywna.' });
    }
    if (row.expires_at < Date.now()) {
      return res.status(403).json({ valid: false, message: 'Licencja wygasła.' });
    }

    // UZNAJEMY ZA "NIEPRZYPISANE", jeśli device_id jest null/undefined/pusty string
    const unbound = row.device_id === null || row.device_id === undefined || row.device_id === '';
    if (unbound) {
      const sqlUpdate = `UPDATE licenses SET device_id = $1 WHERE license_key = $2`;
      await db.query(sqlUpdate, [deviceId, key]);
      console.log(`[VERIFY] Bound key to device. key=${key} deviceId=${deviceId}`);
    } else if (row.device_id !== deviceId) {
      console.warn(`[VERIFY] Device mismatch. key=${key} incoming=${deviceId} bound=${row.device_id}`);
      return res.status(403).json({ valid: false, message: 'Ten klucz licencyjny jest już używany na innym urządzeniu.' });
    }
    
    res.json({
      valid: true,
      message: 'Licencja jest aktywna i poprawna dla tego urządzenia.',
      expires_at: new Date(parseInt(row.expires_at)).toISOString()
    });

  } catch (err) {
    console.error('Błąd podczas sprawdzania klucza:', err.message);
    res.status(500).json({ valid: false, message: 'Błąd serwera.' });
  }
});

app.listen(port, () => {
  console.log(`Serwer licencyjny nasłuchuje na http://localhost:${port}`);
});