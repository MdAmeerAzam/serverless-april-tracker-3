const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20, // Supported by Supabase Transaction Pooler (Port 6543)
  idleTimeoutMillis: 1000, // Fast release for serverless concurrency
  connectionTimeoutMillis: 5000
});

module.exports = { pool };
