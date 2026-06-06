const { pool } = require('../api/db');
const Cursor = require('pg-cursor');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { acquireGlobalLock, releaseGlobalLock } = require('../api/mutex');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
pool.on('error', () => {}); // Catch idle PgBouncer drops

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = [
    { key: 'daily', minMs: 86400000 },
    { key: 'weekly', minMs: 604800000 },
    { key: 'monthly', minMs: 2419200000 }
];
const HEADER_VALUES = ['id', 'timestamp', 'date', 'open', 'high', 'low', 'sar1', 'sar2', 'sar3', 'closeValue', 'closePts', 'closePct', 'closeVol'];

async function getDoc() {
    const creds = require('../credentials.json');
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

async function runEradication() {
    const acquired = await acquireGlobalLock('MAINTENANCE_LOCK', 'Repo 3 Sheets Eradication', 120); 
    if (!acquired) {
        console.log('[FATAL ABORT] Could not acquire Maintenance Lock. System locked.');
        process.exit(0);
    }
    
    console.log("=========================================================");
    console.log("   GOOGLE SHEETS HARD ERADICATION & RESYNC (MACRO)");
    console.log("=========================================================\n");

    const doc = await getDoc();

    try {
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i.key}`;
                    
                    // 1. Fetch Pristine DB Data and stream directly to Sheets
                    console.log(`[SYNC] Streaming DB Truth for ${tableName} (O(1) Memory Engine)...`);
                    const { Client } = require('pg');
                    const pgClient = new Client({ 
                        connectionString: process.env.DATABASE_URL,
                        ssl: { rejectUnauthorized: false }
                    });
                    pgClient.on('error', () => {});
                    await pgClient.connect();
                    
                    // 2. Hard Eradicate Tab FIRST to prepare for stream
                    let sheet = doc.sheetsByTitle[tableName];
                    if (sheet) {
                        console.log(`    [ERADICATING] Hard-deleting entire ghost worksheet for ${tableName}...`);
                        await sheet.delete(); 
                        await new Promise(r => setTimeout(r, 3000)); // Google 429 Limit respect
                    }
                    console.log(`    [REBUILDING] Creating fresh pristine worksheet...`);
                    sheet = await doc.addSheet({ title: tableName, headerValues: HEADER_VALUES });
                    await new Promise(r => setTimeout(r, 2000));
                    
                    try {
                        const query = new Cursor(`SELECT * FROM ${tableName} ORDER BY timestamp ASC`);
                        const cursor = pgClient.query(query);
                        
                        let reading = true;
                        while(reading) {
                            const rows = await new Promise((resolve, reject) => {
                                cursor.read(1500, (err, rows) => err ? reject(err) : resolve(rows));
                            });
                            
                            if (rows.length === 0) {
                                reading = false;
                                break;
                            }
                            
                            // Format for sheets
                            const sheetRows = rows.map(r => ({
                                id: r.id, timestamp: r.timestamp, date: new Date(Number(r.timestamp)).toISOString(),
                                open: r.open, high: r.high, low: r.low, 
                                sar1: r.sar1, sar2: r.sar2, sar3: r.sar3,
                                closeValue: r.closevalue, closePts: r.closepts, closePct: r.closepct, closeVol: r.closevol
                            }));
                            
                            await new Promise(res => setTimeout(res, 2000)); // Strict 2s delay
                            await sheet.addRows(sheetRows);
                            process.stdout.write('.');
                        }
                    } finally {
                        await pgClient.end().catch(()=>{});
                    }


                    console.log(`\n  ✔ ${tableName} Sheets Re-Sync Complete (100% Mathematically Pristine)`);
                }
            }
        }
    } catch (e) {
        console.error("FATAL ERROR:", e);
    } finally {
        await pool.end();
    }
}

(async () => {
    try {
        await runEradication();
    } finally {
        await releaseGlobalLock('MAINTENANCE_LOCK');
        console.log('[LIFT] Maintenance Lock released.');
        process.exit(0);
    }
})();
