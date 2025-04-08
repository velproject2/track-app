const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');
const { Client } = require('cassandra-driver');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const Entry = require('./models/Entry');
const TrackPrice = require('./models/TrackPrice');
const GSTRate = require('./models/GSTRate');
const Auth = require('./models/Auth');

console.log('Starting server...');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const client = new Client({
  cloud: { secureConnectBundle: process.env.ASTRA_DB_SECURE_BUNDLE_PATH },
  credentials: { username: 'token', password: process.env.ASTRA_DB_APPLICATION_TOKEN }
});

async function connectToAstra() {
  try {
    await client.connect();
    console.log('Connected to Astra DB');
    await client.execute(`USE ${process.env.ASTRA_DB_KEYSPACE}`);

    await Entry.initialize(client);
    await TrackPrice.initialize(client);
    await GSTRate.initialize(client);
    await Auth.initialize(client);

    async function manageDummyEntry() {
      const dummyApxNumber = `DUMMY_${uuidv4()}`;
      const dummyCheckInTime = new Date().toISOString();
      const insertQuery = `
        INSERT INTO test_entries (
          apxNumber, modelName, track, trackNumber, driverName, email, checkInTime, checkOutTime, totalPrice
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertParams = [
        dummyApxNumber, 'DummyModel', 'DummyTrack', 'DTN001', 'DummyDriver',
        'dummy@example.com', dummyCheckInTime, null, null // Changed from 0.0 to null
      ];
      await client.execute(insertQuery, insertParams, { prepare: true });
      console.log(`Dummy entry added: ${dummyApxNumber} at ${dummyCheckInTime}`);
      await client.execute(
        `DELETE FROM test_entries WHERE apxNumber = ? AND checkInTime = ?`,
        [dummyApxNumber, dummyCheckInTime],
        { prepare: true }
      );
      console.log(`Dummy entry deleted: ${dummyApxNumber} at ${dummyCheckInTime}`);
    }

    schedule.scheduleJob('0 0 * * *', async () => {
      try {
        await manageDummyEntry();
      } catch (error) {
        console.error('Error managing dummy entry:', error);
      }
    });

    module.exports.client = client;

    const entryRoutes = require('./routes/entryRoutes');
    const adminRoutes = require('./routes/adminRoutes');

    app.use('/api', entryRoutes);
    app.use('/api/admin', adminRoutes);

    app.get('/api/admin/credentials', async (req, res) => {
      try {
        const result = await client.execute('SELECT * FROM auth_credentials');
        const credentials = {};
        result.rows.forEach(row => {
          credentials[row.id] = row.password;
        });
        res.json(credentials);
      } catch (error) {
        console.error('Error fetching credentials:', error);
        res.status(500).json({ error: 'Failed to fetch credentials' });
      }
    });

    app.put('/api/admin/update-password', async (req, res) => {
      const { id, oldPassword, newPassword } = req.body;
      if (!id || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'id, oldPassword, and newPassword are required' });
      }
      if (id !== 'admin' && id !== 'dashboard') {
        return res.status(400).json({ error: 'Invalid id. Must be "admin" or "dashboard"' });
      }
      try {
        const result = await client.execute(
          'SELECT password FROM auth_credentials WHERE id = ?',
          [id],
          { prepare: true }
        );
        const currentPassword = result.rows[0]?.password;
        if (currentPassword !== oldPassword) {
          return res.status(401).json({ error: 'Old password is incorrect' });
        }
        await client.execute(
          'UPDATE auth_credentials SET password = ? WHERE id = ?',
          [newPassword, id],
          { prepare: true }
        );
        console.log(`Password updated for ${id}`);
        res.json({ message: `Password for ${id} updated successfully` });
      } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ error: 'Failed to update password' });
      }
    });

    // Updated Route: Fetch incomplete entries based on totalPrice = null
    app.get('/api/incomplete-entries', async (req, res) => {
      const { track } = req.query;
      if (!track) {
        return res.status(400).json({ error: 'Track is required' });
      }
      try {
        const query = `
          SELECT * FROM test_entries 
          WHERE track = ? 
          ALLOW FILTERING
        `;
        const result = await client.execute(query, [track], { prepare: true });
        console.log(`Total entries fetched for ${track}:`, result.rows.length);
        const incompleteEntries = result.rows.filter(row => row.totalprice === null);
        console.log(`Incomplete entries (totalPrice = null) for ${track}:`, incompleteEntries);
        res.json(incompleteEntries);
      } catch (error) {
        console.error('Error fetching incomplete entries:', error);
        res.status(500).json({ error: 'Failed to fetch incomplete entries' });
      }
    });

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Astra DB connection error:', err);
    process.exit(1);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../Frontend')));
app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.url}`);
  next();
});

connectToAstra();