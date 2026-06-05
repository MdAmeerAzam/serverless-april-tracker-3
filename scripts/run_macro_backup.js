const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { pool } = require('../api/db');
const path = require('path');

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

const HEADER_VALUES = ['id', 'timestamp', 'date', 'open', 'high', 'low', 'sar1', 'sar2', 'sar3', 'closeValue', 'closePts', 'closePct', 'closeVol'];

async function run() {
    console.log("[GitHub Actions] Starting High-Precision Macro Backup...");
    const doc = await getDoc(SPREADSHEET_ID);
    
    const tables = [];
    for (const a of ASSETS) {
        for (const m of MARKETS) {
            for (const i of INTERVALS) {
                tables.push(`${a}_${m}_${i}`);
            }
        }
    }

    // PHASE 1: Fetch maxTimestamps (SLOW)
    const sheetTimestamps = {};
    for (const tableName of tables) {
        let sheet = doc.sheetsByTitle[tableName];
        let maxTimestamp = 0;
        if (sheet) {
            try {
                const existingRows = await sheet.getRows();
                if (existingRows.length > 0) {
                    maxTimestamp = Number(existingRows[existingRows.length - 1].get('timestamp'));
                }
            } catch(e) {}
        }
        sheetTimestamps[tableName] = maxTimestamp;
    }

    // PHASE 2: Query PostgreSQL (FAST)
    const dbRowsToAppend = {};
    const client = await pool.connect();
    try {
        for (const tableName of tables) {
            const maxTimestamp = sheetTimestamps[tableName] || 0;
            const { rows: pgRows } = await client.query(
                `SELECT * FROM ${tableName} WHERE timestamp >= $1 ORDER BY timestamp ASC`,
                [maxTimestamp]
            );
            dbRowsToAppend[tableName] = pgRows;
        }
    } finally {
        client.release();
        await pool.end(); // completely sever connection
    }

    // PHASE 3: Write Google Sheets (SLOW)
    for (const tableName of tables) {
        const pgRows = dbRowsToAppend[tableName];
        if (!pgRows || pgRows.length === 0) continue;

        let sheet = doc.sheetsByTitle[tableName];
        if (!sheet) {
            sheet = await doc.addSheet({ title: tableName, headerValues: HEADER_VALUES });
        } else {
            try { await sheet.getRows(); } catch(e) { await sheet.setHeaderRow(HEADER_VALUES); }
        }

        const toAppend = pgRows.map(r => ({
            id:         r.id,
            timestamp:  r.timestamp,
            date:       new Date(Number(r.timestamp)).toISOString(),
            open:       r.open,
            high:       r.high,
            low:        r.low,
            sar1:       r.sar1,
            sar2:       r.sar2,
            sar3:       r.sar3,
            closeValue: r.closevalue,
            closePts:   r.closepts,
            closePct:   r.closepct,
            closeVol:   r.closevol
        }));

        const maxTimestamp = sheetTimestamps[tableName] || 0;
        if (maxTimestamp > 0 && toAppend.length > 0 && Number(toAppend[0].timestamp) === maxTimestamp) {
            const lastRow = (await sheet.getRows()).pop();
            Object.assign(lastRow, toAppend[0]);
            await lastRow.save();
            toAppend.shift();
        }

        if (toAppend.length > 0) {
            await sheet.addRows(toAppend);
            console.log(`  ✔ [Back-up] ${tableName}: ${toAppend.length} rows pushed`);
        }
        await new Promise(res => setTimeout(res, 1100));
    }
    process.exit(0);
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
