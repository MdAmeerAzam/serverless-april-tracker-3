const { Client } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function initDB() {
    let connected = false;
    let retries = 0;
    let client;
    
    while (!connected && retries < 10) {
        client = new Client({ 
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        client.on('error', () => {});
        
        try {
            await client.connect();
            connected = true;
        } catch (e) {
            retries++;
            console.log(`[!] PgBouncer Exhausted. Retrying DB connect... (${retries}/10)`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    
    if (!connected) {
        console.error("FATAL: Could not connect to Supabase after 10 retries.");
        process.exit(1);
    }
    
    try {
        console.log("Connected to Supabase. Creating system_locks table...");
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS system_locks (
                lock_id VARCHAR(50) PRIMARY KEY,
                locked_by VARCHAR(100) NOT NULL,
                locked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL
            );
        `);
        
        console.log("system_locks table successfully initialized!");
    } catch(e) {
        console.error("Initialization Failed:", e);
        process.exit(1);
    } finally {
        await client.end();
        process.exit(0);
    }
}

initDB();
