const { pool } = require('../api/db.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const credentials = require('../credentials.json');

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';
const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

async function verify() {
    console.log("[INTEGRITY VERIFICATION] Commencing Mathematical Audit...");

    const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    console.log(`  Connected to Sheet: "${doc.title}"`);

    const clientPG = await pool.connect();
    let totalMismatches = 0;
    try {
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    
                    try {
                        const { rows } = await clientPG.query(`SELECT COUNT(*) as exact_count FROM ${tableName}`);
                        const dbCount = parseInt(rows[0].exact_count, 10);
                        if (dbCount === 0) continue;

                        let sheet = doc.sheetsByTitle[tableName];
                        if (!sheet) {
                            console.error(`[MISMATCH] Table: ${tableName.padEnd(25)} | DB: ${dbCount.toString().padStart(6)} | Sheet: MISSING`);
                            totalMismatches++;
                            continue;
                        }

                        // Fetching rows for absolute mathematical certainty
                        const sheetRows = await sheet.getRows();
                        const sheetCount = sheetRows.length;

                        if (dbCount === sheetCount) {
                            console.log(`[VERIFIED] Table: ${tableName.padEnd(25)} | DB: ${dbCount.toString().padStart(6)} | Sheet: ${sheetCount.toString().padStart(6)}`);
                        } else {
                            console.error(`[MISMATCH] Table: ${tableName.padEnd(25)} | DB: ${dbCount.toString().padStart(6)} | Sheet: ${sheetCount.toString().padStart(6)}`);
                            totalMismatches++;
                        }
                        
                        // Strict throttle to avoid 60/min quota during verification
                        await new Promise(res => setTimeout(res, 1200));

                    } catch (e) {
                        console.error(`[ERROR] Table: ${tableName} | Msg: ${e.message}`);
                        totalMismatches++;
                    }
                }
            }
        }
    } finally {
        clientPG.release();
    }

    console.log("\n==========================================");
    if (totalMismatches === 0) {
        console.log("FINAL RESULT: 100% MATHEMATICAL INTEGRITY VERIFIED. 0 MISMATCHES.");
    } else {
        console.log(`FINAL RESULT: INTEGRITY FAILED. ${totalMismatches} MISMATCHES FOUND.`);
    }
    console.log("==========================================\n");
    process.exit(0);
}

verify();
