async function initialize(client) {
    try {
      await client.execute(
        'CREATE TABLE IF NOT EXISTS auth_credentials (id text PRIMARY KEY, password text)'
      );
      // Insert default passwords if they don’t exist
      await client.execute(
        "INSERT INTO auth_credentials (id, password) VALUES ('admin', 'admin') IF NOT EXISTS"
      );
      await client.execute(
        "INSERT INTO auth_credentials (id, password) VALUES ('dashboard', 'dashboard123') IF NOT EXISTS"
      );
      console.log('auth_credentials table initialized with default passwords');
    } catch (err) {
      console.error('Error initializing auth_credentials table:', err);
      throw err;
    }
  }
  
  module.exports = { initialize };