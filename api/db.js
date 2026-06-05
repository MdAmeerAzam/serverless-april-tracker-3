const { Pool } = require('pg');

const rawUri = process.env.DATABASE_URL || "postgresql://postgres.ybnpnpisvalswxyjjfvx:Qzh3nc8S%40UQezjc@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
const uri = rawUri.replace(':6543', ':5432').replace('?pgbouncer=true', '');

// Trial Bypass: Connecting directly to Session port (5432) to evade PgBouncer deadlock
const pool = new Pool({
    connectionString: uri,
    ssl: { rejectUnauthorized: false },
    max: 5, 
    idleTimeoutMillis: 1000, 
    connectionTimeoutMillis: 15000 // Increased timeout for trial
});

module.exports = { pool };
