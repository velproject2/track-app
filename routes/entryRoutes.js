const express = require('express');
const router = express.Router();
const { client } = require('../server');
const nodemailer = require('nodemailer');

console.log('entryRoutes loaded');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

async function sendEmail(to, subject, text) {
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to,
      subject,
      text
    };
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

router.post('/checkin', async (req, res) => {
  try {
    console.log('Received /checkin request:', req.body);
    const { apxNumber, modelName, track, trackNumber, vehicleWeight, driverName, checkInTime, email } = req.body;

    const result = await client.execute(
      'SELECT * FROM test_entries WHERE apxNumber = ? AND checkOutTime = ? ALLOW FILTERING',
      [apxNumber, ''],
      { prepare: true }
    );
    if (result.rows.length > 0) {
      console.log('Active check-in found, rejecting request');
      return res.status(400).json({ message: 'This APX Number has an active check-in!' });
    }

    const nowUTC = new Date(Date.now());
    const entry = {
      apxNumber,
      modelName,
      track,
      trackNumber,
      vehicleWeight,
      driverName,
      email,
      checkInTime: checkInTime || nowUTC.toISOString(),
      checkOutTime: '',
      totalPrice: null
    };
    console.log('Prepared entry to insert:', entry);

    await client.execute(
      'INSERT INTO test_entries (apxNumber, modelName, track, trackNumber, vehicleWeight, driverName, email, checkInTime, checkOutTime, totalPrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [entry.apxNumber, entry.modelName, entry.track, entry.trackNumber, entry.vehicleWeight, entry.driverName, entry.email, entry.checkInTime, entry.checkOutTime, entry.totalPrice],
      { prepare: true }
    );
    console.log('Entry inserted successfully');

    res.status(201).json(entry);
  } catch (error) {
    console.error('Error in /checkin:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    console.log('Received /checkout request:', req.body);
    const { apxNumber, checkOutTime } = req.body;

    if (!apxNumber) {
      console.log('Missing apxNumber in request');
      return res.status(400).json({ message: 'APX Number is required' });
    }

    const result = await client.execute(
      'SELECT * FROM test_entries WHERE apxNumber = ? AND checkOutTime = ? ALLOW FILTERING',
      [apxNumber, ''],
      { prepare: true }
    );
    if (result.rows.length === 0) {
      console.log('No active check-in found for apxNumber:', apxNumber);
      return res.status(400).json({ message: 'No matching Check-In found for this APX Number!' });
    }

    const entry = result.rows[0];
    console.log('Found entry:', entry);

    const checkInTime = entry.checkintime;
    const nowUTC = new Date(Date.now());
    const checkOut = checkOutTime || nowUTC.toISOString();
    const hoursUtilized = calculateHours(checkInTime, checkOut);
    const hoursBilled = Math.ceil(hoursUtilized);

    if (!entry.track || !entry.tracknumber) {
      console.log('Missing track or trackNumber in entry:', entry);
      return res.status(400).json({ message: 'Check-in entry is missing track or trackNumber data!' });
    }

    const vehicleWeight = entry.vehicleweight || 'less_than_3.5'; // Default if null
    console.log('Using vehicleWeight:', vehicleWeight);

    const priceResult = await client.execute(
      'SELECT price FROM track_prices WHERE track = ? AND subTrack = ? AND vehicleWeight = ?',
      [entry.track, entry.tracknumber, vehicleWeight],
      { prepare: true }
    );
    let price;
    if (priceResult.rows.length === 0) {
      console.warn(`No price found for track: ${entry.track}, subTrack: ${entry.tracknumber}, vehicleWeight: ${vehicleWeight}. Defaulting to 0`);
      price = 0; // Fallback price
      // Optionally notify admin
      await sendEmail(
        process.env.ADMIN_EMAIL,
        'Missing Price Alert',
        `No price defined for track: ${entry.track}, subTrack: ${entry.tracknumber}, vehicleWeight: ${vehicleWeight}. Please add it in the admin panel.`
      );
    } else {
      price = priceResult.rows[0].price;
    }
    console.log('Price fetched:', price);

    const gstResult = await client.execute('SELECT rate FROM gst_rate WHERE id = ?', ['default'], { prepare: true });
    const gstRate = gstResult.rows.length > 0 ? gstResult.rows[0].rate : 0;
    console.log('GST rate fetched:', gstRate);

    const totalPrice = hoursBilled * price * (1 + gstRate / 100);

    await client.execute(
      'UPDATE test_entries SET checkOutTime = ?, totalPrice = ? WHERE apxNumber = ? AND checkInTime = ?',
      [checkOut, totalPrice, apxNumber, checkInTime],
      { prepare: true }
    );
    console.log('Entry updated successfully');

    await sendEmail(
      entry.email,
      'Check-Out Confirmation :)',
      `Hello,\n\nCheck-out has been completed by: ${entry.drivername}\nfor APX Number: ${apxNumber}\nModel: ${entry.modelname}\nTrack: ${entry.track} - ${entry.tracknumber}\nVehicle Weight: ${vehicleWeight === 'less_than_3.5' ? 'Less than 3.5 tonnes' : 'Greater than 3.5 tonnes'}\nCheck-In: ${checkInTime}\nCheck-Out: ${checkOut}\nHours Utilized: ${hoursUtilized.toFixed(2)}\nTotal Price(Incl.GST): ₹${totalPrice.toFixed(2)}\n\nThank you!\n\n\nRegards@VEL`
    );

    const updatedEntry = { ...entry, checkOutTime: checkOut, totalPrice };
    res.status(200).json(updatedEntry);
  } catch (error) {
    console.error('Error in /checkout for apxNumber:', apxNumber, error);
    res.status(500).json({ message: `Failed to complete entry: ${error.message}` });
  }
});

router.post('/delete-selected', async (req, res) => {
  try {
    console.log('Received /delete-selected request:', req.body);
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'No entries provided for deletion' });
    }

    const queries = entries.map(entry => ({
      query: 'DELETE FROM test_entries WHERE apxNumber = ? AND checkInTime = ?',
      params: [entry.apxNumber, entry.checkInTime]
    }));

    await client.batch(queries, { prepare: true });
    console.log(`Deleted ${entries.length} entries successfully`);

    const nowUTC = new Date(Date.now());
    await sendEmail(
      process.env.ADMIN_EMAIL,
      'ALERT!!!\n TRACK ENTRIES DELETED..',
      `The following ${entries.length} entries were deleted from the dashboard\n\nPerformed on: ${nowUTC.toISOString()}\n${entries.map(entry => `APX Number: ${entry.apxNumber}, Check-In Time: ${entry.checkInTime}`).join('\n')}`
    );

    res.status(204).send();
  } catch (error) {
    console.error('Error in /delete-selected:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/entries', async (req, res) => {
  try {
    console.log('Received /entries request');
    const result = await client.execute('SELECT * FROM test_entries', [], { prepare: true });
    console.log('Fetched entries:', result.rows.length, 'rows');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error in /entries:', error);
    res.status(500).json({ message: error.message });
  }
});

router.delete('/entries', async (req, res) => {
  try {
    console.log('Received /entries delete request');
    await client.execute('TRUNCATE test_entries');
    console.log('Entries truncated');
    res.status(204).send();
  } catch (error) {
    console.error('Error in /entries delete:', error);
    res.status(500).json({ message: error.message });
  }
});

function calculateHours(checkInTime, checkOutTime) {
  const start = new Date(checkInTime);
  const end = new Date(checkOutTime);
  const diffMs = Math.abs(end - start);
  return diffMs / (1000 * 60 * 60);
}

module.exports = router;
