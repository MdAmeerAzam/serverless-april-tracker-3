const { pool } = require('../api/db');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

(async () => {
    const client = await pool.connect();
    try {
        console.log('\n[Macro Cloud Health Check]');
        console.log('──────────────────────────────────────────────────────────');
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    const res = await client.query(`SELECT COUNT(*) FROM ${tableName}`);
                    const count = res.rows[0].count;
                    const latest = await client.query(`SELECT timestamp FROM ${tableName} ORDER BY timestamp DESC LIMIT 1`);
                    const ts = latest.rows.length > 0 ? new Date(Number(latest.rows[0].timestamp)).toISOString().slice(0, 10) : 'N/A';
                    console.log(`${tableName.padEnd(25)} | ${String(count).padStart(6)} rows | Latest: ${ts}`);
                }
            }
        }
        console.log('──────────────────────────────────────────────────────────');
    } catch (e) {
        console.error('Audit failed:', e.message);
    } finally {
        client.release();
        process.exit(0);
    }
})();
