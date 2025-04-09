const express = require('express');
const router = express.Router();
const { client } = require('../server');

router.post('/track-prices', async (req, res) => {
  try {
    console.log('POST /api/admin/track-prices received:', req.body);
    const { track, subTrack, vehicleWeight, price } = req.body;

    if (!track || !subTrack || !vehicleWeight || typeof price !== 'number' || isNaN(price)) {
      console.log('Invalid input:', { track, subTrack, vehicleWeight, price });
      return res.status(400).json({ message: 'Invalid input: track, subTrack, vehicleWeight, and price (number) are required' });
    }

    await client.execute(
      'INSERT INTO track_prices (track, subTrack, vehicleWeight, price) VALUES (?, ?, ?, ?)',
      [track, subTrack, vehicleWeight, price],
      { prepare: true }
    );

    const updatedPrice = { track, subTrack, vehicleWeight, price };
    console.log('Successfully updated price in DB:', updatedPrice);
    res.status(200).json(updatedPrice);
  } catch (error) {
    console.error('Error updating track price:', error);
    res.status(500).json({ message: `Failed to update price: ${error.message}` });
  }
});

router.get('/track-prices', async (req, res) => {
  try {
    console.log('GET /api/admin/track-prices called');
    const result = await client.execute('SELECT * FROM track_prices');
    console.log('Fetched prices:', result.rows);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching track prices:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/gst-rate', async (req, res) => {
  try {
    console.log('POST /api/admin/gst-rate received:', req.body);
    const { gstRate } = req.body;

    await client.execute(
      'UPDATE gst_rate SET rate = ? WHERE id = ?',
      [gstRate, 'default'],
      { prepare: true }
    );

    console.log('Updated GST rate:', gstRate);
    res.status(200).json(gstRate);
  } catch (error) {
    console.error('Error updating GST rate:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/gst-rate', async (req, res) => {
  try {
    console.log('GET /api/admin/gst-rate called');
    const result = await client.execute('SELECT rate FROM gst_rate WHERE id = ?', ['default']);
    const rate = result.rows.length > 0 ? result.rows[0].rate : 0;
    console.log('Fetched GST rate:', rate);
    res.status(200).json(rate);
  } catch (error) {
    console.error('Error fetching GST rate:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
