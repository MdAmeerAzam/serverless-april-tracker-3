const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');

const SPREADSHEET_ID = '1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA';
const ASSETS = ['gold', 'silver', 'brent', 'wti', 'natgas'];
const MARKETS = ['spot', 'futures'];
const INTERVALS = ['daily', 'weekly', 'monthly'];

(async () => {
    try {
        console.log('\n[Sheet Reset] Wiping Macro data rows to force fresh high-precision sync...');
        const creds = require(path.join(process.cwd(), 'credentials.json'));
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
        });
        const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
        await doc.loadInfo();

        for (const a of ASSETS) {
            for (const m of MARKETS) {
                for (const i of INTERVALS) {
                    const title = `${a}_${m}_${i}`;
                    const sheet = doc.sheetsByTitle[title];
                    if (sheet) {
                        process.stdout.write(`  → Clearing ${title}... `);
                        await sheet.clearRows();
                        console.log('done');
                        await new Promise(res => setTimeout(res, 800)); // Respect quota
                    }
                }
            }
        }
        console.log('\n[Success] Google Sheet is now a clean canvas.');
    } catch (e) {
        console.error('Reset failed:', e.message);
    } finally {
        process.exit(0);
    }
})();
