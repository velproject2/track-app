async function initialize(client) {
    try {
      await client.execute(
        'CREATE TABLE IF NOT EXISTS track_prices (track text, subTrack text, vehicleWeight text, price double, PRIMARY KEY ((track, subTrack), vehicleWeight))'
      );
      console.log('Track_prices table initialized');
    } catch (err) {
      console.error('Error initializing track_prices table:', err);
      throw err;
    }
  }
  
  module.exports = { initialize };
