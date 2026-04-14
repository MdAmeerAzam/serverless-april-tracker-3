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
    const client = await pool.connect();
    try {
        const doc = await getDoc(SPREADSHEET_ID);
        
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const tableName = `${a}_${m}_${i}`;
                    await backupTableToSheet(client, doc, tableName);
                    // 1.1s delay to respect 60 writes/min quota
                    await new Promise(res => setTimeout(res, 1100));
                }
            }
        }
    } catch (e) {
        console.error("[Fatal] Backup failed:", e.message);
    } finally {
        client.release();
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

async function backupTableToSheet(client, doc, tableName) {
    let sheet = doc.sheetsByTitle[tableName];
    let maxTimestamp = 0;

    if (!sheet) {
        sheet = await doc.addSheet({ title: tableName, headerValues: HEADER_VALUES });
    } else {
        const rows = await sheet.getRows();
        if (rows.length > 0) {
            maxTimestamp = Number(rows[rows.length - 1].get('timestamp'));
        }
    }

    const { rows: pgRows } = await client.query(`SELECT * FROM ${tableName} WHERE timestamp >= $1 ORDER BY timestamp ASC`, [maxTimestamp]);
    
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

    if (maxTimestamp > 0 && toAppend.length > 0 && Number(toAppend[0].timestamp) === maxTimestamp) {
        const lastRow = (await sheet.getRows()).pop();
        Object.assign(lastRow, toAppend[0]);
        await lastRow.save();
        toAppend.shift();
    }

    if (toAppend.length > 0) {
        await sheet.addRows(toAppend);
        console.log(`  ✔ [Back-up] ${tableName}: ${toAppend.length} rows pushed`);
    } else {
        console.log(`  ✔ [Clean] ${tableName}: Up to date`);
    }
}

run();
