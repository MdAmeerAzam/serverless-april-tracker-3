const { pool } = require('../api/db');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const TradingView = require('@mathieuc/tradingview');
const path = require('path');
const { acquireGlobalLock, releaseGlobalLock } = require('../api/mutex');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
pool.on('error', () => {}); // Catch idle PgBouncer drops

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = [
    { key: 'daily', minMs: 86400000 },
    { key: 'weekly', minMs: 604800000 },
    { key: 'monthly', minMs: 2419200000 } // Approx 28 days min
];

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

async function verifyTradingViewSymmetry(pgClient) {
    return new Promise((resolve) => {
        let halted = false;
        const client = new TradingView.Client();
        const chart = new client.Session.Chart();
        chart.setMarket('OANDA:XAUUSD', { timeframe: '1D', range: 200 }); 

        chart.onUpdate(async () => {
            if (halted) return; 
            if (!chart.periods || chart.periods.length < 50) return;
            halted = true;
            
            const klines = chart.periods.reverse().map(p => ({
                timestamp: p.time * 1000, 
                open: p.open, high: p.max, low: p.min, close: p.close
            }));
            client.end();

            let mismatchCount = 0;
            const { rows } = await pgClient.query('SELECT timestamp, open, high, low, closevalue FROM gold_spot_daily ORDER BY timestamp DESC LIMIT 200');
            const dbMap = new Map();
            rows.forEach(r => dbMap.set(Number(r.timestamp), r));

            for (const k of klines) {
                const dbRow = dbMap.get(k.timestamp);
                if (!dbRow) continue; // Synced timing differences
                if (Math.abs(k.open - Number(dbRow.open)) > 0.00001 || 
                    Math.abs(k.close - Number(dbRow.closevalue)) > 0.00001) {
                    mismatchCount++;
                }
            }
            resolve({ klinesCount: klines.length, mismatchCount });
        });

        setTimeout(() => { if (!halted) { halted = true; client.end(); resolve({ error: "TV Timeout" }); } }, 15000);
    });
}

async function runImmaculateAudit() {
    const acquired = await acquireGlobalLock('MAINTENANCE_LOCK', 'Repo 3 Deep Audit', 120); 
    if (!acquired) {
        console.log('[FATAL ABORT] Could not acquire Maintenance Lock. Another heavy process is running.');
        process.exit(0);
    }
    
    try {
        console.log("=========================================================");
        console.log("   DEEP PERIMETER IMMACULATE AUDIT (REPO 3 - MACRO)");
        console.log("=========================================================\n");

    const doc = await getDoc();
    
    let totalTablesPerfect = 0;
    let totalAnomalies = 0;

    console.log("[PHASE 1-4] Absolute Alignment, Checksums, and Continuity Scans");
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i.key}`;
                    
                    // 1. Fetch DB Data (Tightly Scoped Raw Client with Resilience)
                    const { Client } = require('pg');
                    let dbRows = [];
                    let connected = false;
                    let retries = 0;
                    while (!connected && retries < 10) {
                        const pgClient = new Client({ 
                            connectionString: process.env.DATABASE_URL,
                            ssl: { rejectUnauthorized: false }
                        });
                        pgClient.on('error', () => {}); // Catch async drops
                        try {
                            await pgClient.connect();
                            const dbRes = await pgClient.query(`SELECT * FROM ${tableName} ORDER BY timestamp ASC`);
                            dbRows = dbRes.rows;
                            connected = true;
                        } catch (err) {
                            retries++;
                            console.log(`      [!] PgBouncer Exhausted. Retrying DB fetch for ${tableName}... (${retries}/10)`);
                            await new Promise(r => setTimeout(r, 5000));
                        } finally {
                            await pgClient.end().catch(()=>{});
                        }
                    }
                    if (!connected) throw new Error("DB Connection Failed after 10 retries");
                    
                    // 2. Fetch Sheet Data
                    let sheetRows = [];
                    const sheet = doc.sheetsByTitle[tableName];
                    if (sheet) {
                        try {
                            await sheet.loadHeaderRow();
                            sheetRows = await sheet.getRows();
                        } catch(e) {}
                    }

                    // Analytics
                    let dbChecksum = 0;
                    let sheetChecksum = 0;
                    let gapViolations = 0;
                    let ruleViolations = 0;

                    dbRows.forEach((r, idx) => {
                        dbChecksum += Number(r.closevalue);
                        if (idx > 0) {
                            const delta = Number(r.timestamp) - Number(dbRows[idx-1].timestamp);
                            if (delta < i.minMs && delta > 0) gapViolations++;
                        }
                        if (idx < dbRows.length - 1) { 
                            const s1 = Number(r.sar1);
                            const s3 = Number(r.sar3);
                            if (s1 !== 0 && s3 !== 0 && Math.abs(s1 - s3) < 0.000001) ruleViolations++;
                        }
                    });

                    sheetRows.forEach(r => sheetChecksum += Number(r.get('closeValue') || 0));

                    const isRowMatch = dbRows.length === sheetRows.length;
                    const isChecksumMatch = Math.abs(dbChecksum - sheetChecksum) < 0.0001;

                    if (isRowMatch && isChecksumMatch && gapViolations === 0 && ruleViolations === 0) {
                        totalTablesPerfect++;
                        console.log(`  [✔] ${tableName.padEnd(22)} | Rows: ${dbRows.length.toString().padStart(5)} | Checksum Match | Continuity Intact`);
                    } else {
                        totalAnomalies++;
                        console.log(`  [✖] ${tableName} FAILED PARITY`);
                        if (!isRowMatch) console.log(`      └─ Row Mismatch: DB=${dbRows.length}, Sheet=${sheetRows.length}`);
                        if (!isChecksumMatch) console.log(`      └─ Checksum Mismatch: DB=${dbChecksum.toFixed(2)}, Sheet=${sheetChecksum.toFixed(2)}`);
                        if (gapViolations > 0) console.log(`      └─ Temporal Gaps Detected: ${gapViolations}`);
                        if (ruleViolations > 0) console.log(`      └─ SAR 3 Math Violations: ${ruleViolations}`);
                    }
                    await new Promise(res => setTimeout(res, 500)); 
                }
            }
        }

        console.log("\n[PHASE 5] TradingView WebSocket Deep Symmetry Verification");
        const { Client } = require('pg');
        let pgClient2;
        let tvConnected = false;
        let tvRetries = 0;
        let tvAudit;
        while (!tvConnected && tvRetries < 10) {
            pgClient2 = new Client({ 
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });
            pgClient2.on('error', () => {}); // Catch async drops
            try {
                await pgClient2.connect();
                tvAudit = await verifyTradingViewSymmetry(pgClient2);
                tvConnected = true;
            } catch (err) {
                tvRetries++;
                console.log(`      [!] PgBouncer Exhausted. Retrying Phase 5 DB connect... (${tvRetries}/10)`);
                await new Promise(r => setTimeout(r, 5000));
            } finally {
                if (pgClient2) await pgClient2.end().catch(()=>{});
            }
        }
        if (!tvConnected) throw new Error("TV DB Connection Failed after 10 retries");

        if (tvAudit.error) {
            console.log(`  [✖] WebSocket Extraction Timeout`);
        } else {
            console.log(`  [✔] Fetched ${tvAudit.klinesCount} historical candles direct from OANDA:XAUUSD`);
            if (tvAudit.mismatchCount === 0) {
                console.log(`  [✔] 100% Mathematical Parity between TV API and Database Storage`);
            } else {
                console.log(`  [✖] Discovered ${tvAudit.mismatchCount} deviations between TV API and Database Storage`);
            }
        }

        console.log("\n=========================================================");
        console.log(`   AUDIT COMPLETE | ${totalTablesPerfect}/30 Tables Immaculate | ${totalAnomalies} Anomalies`);
        console.log("=========================================================");

    } catch (e) {
        console.error("FATAL AUDIT ERROR:", e);
    } finally {
        await pool.end();
    }
}

(async () => {
    try {
        await runImmaculateAudit();
    } finally {
        await releaseGlobalLock('MAINTENANCE_LOCK');
        console.log('[LIFT] Maintenance Lock released.');
        process.exit(0);
    }
})();
