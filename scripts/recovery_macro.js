const { pool } = require('../api/db.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const credentials = require('../credentials.json');

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';
const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

async function runInfinityPush() {
    console.log("[INFINITY SHEET PUSH] Commencing Macro Recovery...");

    const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    console.log(`  Connected to Sheet: "${doc.title}"`);

    const headerValues = ['id', 'timestamp', 'date', 'open', 'high', 'low', 'sar1', 'sar2', 'sar3', 'closeValue', 'closePts', 'closePct', 'closeVol'];

    const clientPG = await pool.connect();
    try {
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    console.log(`  Processing ${tableName}...`);

                    try {
                        const { rows } = await clientPG.query(`SELECT * FROM ${tableName} ORDER BY timestamp ASC`);
                        console.log(`    Retrieved ${rows.length} rows from Cloud DB.`);
                        if (rows.length === 0) continue;

                        let sheet = doc.sheetsByTitle[tableName];
                        if (sheet) {
                            await sheet.clear();
                            await sheet.setHeaderRow(headerValues);
                        } else {
                            sheet = await doc.addSheet({ title: tableName, headerValues });
                        }

                        const formattedRows = rows.map(r => ({
                            id: r.id,
                            timestamp: r.timestamp.toString(),
                            date: new Date(Number(r.timestamp)).toISOString(),
                            open: r.open,
                            high: r.high,
                            low: r.low,
                            sar1: r.sar1,
                            sar2: r.sar2,
                            sar3: r.sar3,
                            closeValue: r.closevalue,
                            closePts: r.closepts,
                            closePct: r.closepct,
                            closeVol: r.closevol
                        }));

                        console.log(`    Pushing ${formattedRows.length} rows to Google Sheets...`);
                        const chunkSize = 1000;
                        for (let k = 0; k < formattedRows.length; k += chunkSize) {
                            await sheet.addRows(formattedRows.slice(k, k + chunkSize));
                            await new Promise(res => setTimeout(res, 500));
                        }
                        console.log(`    ✔ ${tableName} Push Complete.`);
                    } catch (e) {
                        console.error(`    ✖ Failure on ${tableName}:`, e.message);
                    }
                }
            }
        }
    } finally {
        clientPG.release();
    }

    console.log("[INFINITY SHEET PUSH] Total Reconstruction Complete. Macro Display is now 1:1 with Database.");
    process.exit(0);
}

runInfinityPush();
