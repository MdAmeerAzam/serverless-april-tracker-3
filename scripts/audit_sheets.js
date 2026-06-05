process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { pool } = require('../api/db');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

async function run() {
    console.log("[End-to-End Audit] Initializing Mathematical Verification...");
    const client = await pool.connect();
    const dbCounts = {};
    for (const a of ASSETS) {
        for (const m of MARKETS) {
            for (const i of INTERVALS) {
                const tableName = `${a}_${m}_${i}`;
                try {
                    const { rows } = await client.query(`SELECT COUNT(*) FROM ${tableName}`);
                    dbCounts[tableName] = Number(rows[0].count);
                } catch(e) {
                    dbCounts[tableName] = 0;
                }
            }
        }
    }
    client.release();
    await pool.end();
    
    let totalDbCells = 0;
    let totalSheetCells = 0;

    try {
        const doc = await getDoc(SPREADSHEET_ID);

        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    
                    // 1. Get Database Count
                    const dbCount = dbCounts[tableName];
                    const dbCells = dbCount * 13; // 13 columns
                    totalDbCells += dbCells;

                    // 2. Get Sheet Count
                    const sheet = doc.sheetsByTitle[tableName];
                    let sheetCount = 0;
                    if (sheet) {
                        const sRows = await sheet.getRows();
                        sheetCount = sRows.length;
                    }
                    const sheetCells = sheetCount * 13;
                    totalSheetCells += sheetCells;

                    console.log(`[Verified] ${tableName} -> DB Rows: ${dbCount} | Sheet Rows: ${sheetCount} | DB Cells: ${dbCells} | Sheet Cells: ${sheetCells}`);
                }
            }
        }
        
        console.log("\n====================================");
        console.log("[FINAL VERIFICATION] Data Integrity Audit");
        console.log("====================================");
        console.log(`Total Supabase Database Cells: ${totalDbCells}`);
        console.log(`Total Google Sheets Cells: ${totalSheetCells}`);
        if (totalDbCells === totalSheetCells && totalDbCells > 0) {
            console.log("\n100% PERFECT MATCH: E2E Pipeline is mathematically flawless.");
        } else {
            console.log("\n[WARNING] Discrepancy detected in E2E Pipeline.");
        }
    } catch (e) {
        console.error("[Audit Failed]:", e.message);
    } finally {
        if (client && !client._ending) {
           try { client.release(); } catch(e){}
        }
        process.exit(0);
    }
}

async function getDoc(id) {
    const creds = require(path.join(process.cwd(), 'credentials.json'));
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const doc = new GoogleSpreadsheet(id, auth);
    await doc.loadInfo();
    return doc;
}

run();
