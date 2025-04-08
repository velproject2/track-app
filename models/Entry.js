async function initialize(client) {
  try {
    await client.execute(
      'CREATE TABLE IF NOT EXISTS test_entries (apxNumber text, modelName text, track text, trackNumber text, driverName text, email text, checkInTime text, checkOutTime text, totalPrice double, PRIMARY KEY (apxNumber, checkInTime))'
    );
    console.log('test_entries table initialized');
  } catch (err) {
    console.error('Error initializing test_entries table:', err);
    throw err;
  }
}

module.exports = { initialize };
