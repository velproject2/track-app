async function initialize(client) {
    try {
      await client.execute(
        'CREATE TABLE IF NOT EXISTS gst_rate (id text PRIMARY KEY, rate double)'
      );
      await client.execute(
        "INSERT INTO gst_rate (id, rate) VALUES ('default', 0) IF NOT EXISTS"
      );
      console.log('GSTRate table initialized with default rate');
    } catch (err) {
      console.error('Error initializing gst_rate table:', err);
      throw err;
    }
  }
  
  module.exports = { initialize };
