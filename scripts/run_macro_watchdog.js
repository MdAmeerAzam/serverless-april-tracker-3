process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { pool } = require('../api/db');

const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = [
    { key: 'daily', min: 1440, label: 'Daily' },
    { key: 'weekly', min: 10080, label: 'Weekly' },
    { key: 'monthly', min: 43200, label: 'Monthly' }
];

async function checkTable(client, asset, market, interval) {
    const tableName = `${asset}_${market}_${interval.key}`;
    const now = Date.now();
    const result = { name: tableName, status: 'OK', errors: [] };

    try {
        const { rows } = await client.query(`SELECT timestamp, sar1, sar2, sar3 FROM ${tableName} ORDER BY timestamp DESC LIMIT 7`);
        if (rows.length === 0) {
            result.status = 'FAIL';
            result.errors.push('Table is empty');
            return result;
        }

        const latest = rows[0];
        const gapMs = now - Number(latest.timestamp);
        const gapUnits = gapMs / (interval.min * 60 * 1000);

        // 1. Sync Gap Check (1.5 candle threshold for Macro)
        if (gapUnits > 1.5) {
            result.errors.push(`Sync Gap: Late by ${gapUnits.toFixed(1)} ${interval.key} candles`);
        }

        let sar2Flatline = true;
        let sar1Missing = false;
        let zeroResetViolation = false;

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const s1 = Number(r.sar1);
            const s2 = Number(r.sar2);
            const s3 = Number(r.sar3);
            const isClosed = (i > 0);

            if (Math.abs(s1) < 0.000001) sar1Missing = true;
            if (Math.abs(s2) > 0.000001) sar2Flatline = false;

            // SAR 3 Zero-Reset Rule: on closed candles, if S3 == S1, it MUST be 0
            if (isClosed && Math.abs(s3) > 0.000001 && Math.abs(s3 - s1) < 0.000001) {
                zeroResetViolation = true;
            }
        }

        if (sar1Missing) result.errors.push('Genesis missing (SAR 1 = 0)');
        if (sar2Flatline) result.errors.push('Algorithm death (SAR 2 flatline)');
        if (zeroResetViolation) result.errors.push('Zero-Reset 3 violation (Dirty historical data)');

        if (result.errors.length > 0) result.status = 'ISSUE';

    } catch (e) {
        result.status = 'FAIL';
        result.errors.push(`Query Error: ${e.message}`);
    }

    return result;
}

(async () => {
    console.log('\n[Cloud Macro WATCHDOG] Initializing Deep Perimeter Scan...');
    const client = await pool.connect();
    let totalIssues = 0;

    try {
        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const audit = await checkTable(client, a, m, i);
                    if (audit.status !== 'OK') {
                        totalIssues++;
                        console.log(`\n✖ [${audit.name}] - ${audit.status}`);
                        audit.errors.forEach(err => console.log(`  └─ ${err}`));
                    } else {
                        process.stdout.write(`✔ [${audit.name}] `);
                    }
                }
                console.log('');
            }
        }

        if (totalIssues > 0) {
            console.log(`\n[CRITICAL] Watchdog detected ${totalIssues} macro anomalies. Triggering system failure alert.\n`);
            process.exit(1); 
        } else {
            console.log('\n[SUCCESS] Macro Perimeter is mathematically secure. No anomalies detected.\n');
            process.exit(0);
        }
    } finally {
        client.release();
    }
})();
