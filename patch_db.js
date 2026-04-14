const { pool } = require('./api/db');

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

async function initializeSupabase() {
    const client = await pool.connect();
    try {
        console.log('\n[Supabase] Initializing 30 High-Precision Macro Tables...');
        
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    const schema = `
                        DROP TABLE IF EXISTS ${tableName};
                        CREATE TABLE ${tableName} (
                            id TEXT PRIMARY KEY,
                            timestamp BIGINT,
                            open DECIMAL(24, 12),
                            high DECIMAL(24, 12),
                            low DECIMAL(24, 12),
                            sar1 DECIMAL(24, 12),
                            sar2 DECIMAL(24, 12),
                            sar3 DECIMAL(24, 12),
                            closevalue DECIMAL(24, 12),
                            closepts DECIMAL(24, 12),
                            closepct DECIMAL(24, 12),
                            closevol DECIMAL(24, 12)
                        );
                        CREATE INDEX idx_${tableName}_ts ON ${tableName}(timestamp DESC);
                    `;
                    process.stdout.write(`  → Creating ${tableName}... `);
                    await client.query(schema);
                    console.log('done');
                }
            }
        }
        console.log('\n[Success] Supabase Macro Schema is now physically secure.');
    } catch (e) {
        console.error('\n[Error] Schema initialization failed:', e.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

initializeSupabase();
