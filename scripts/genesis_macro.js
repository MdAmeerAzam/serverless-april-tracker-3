const TradingView = require('@mathieuc/tradingview');
const { PSAR } = require('technicalindicators');
process.env.DATABASE_URL = "postgresql://postgres.ybnpnpisvalswxyjjfvx:Qzh3nc8S%40UQezjc@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { pool } = require('../api/db');

const TICKER_MAP = {
    gold: { spot: 'OANDA:XAUUSD', futures: 'COMEX:GC1!' },
    silver: { spot: 'OANDA:XAGUSD', futures: 'COMEX:SI1!' },
    brent: { spot: 'TVC:UKOIL', futures: 'ICEEUR:BRN1!' },
    wti: { spot: 'TVC:USOIL', futures: 'NYMEX:CL1!' },
    natgas: { spot: 'OANDA:NATGASUSD', futures: 'NYMEX:NG1!' }
};

const TIMEFRAME_MAP = {
    daily: '1D',
    weekly: '1W',
    monthly: '1M'
};

async function run() {
    console.log("[Deep Extractor] Initializing Standalone TradingView Handshake for GENESIS...");
    const client = await pool.connect();
    try {
        for (const asset of Object.keys(TICKER_MAP)) {
            for (const market of ['spot', 'futures']) {
                const rawTicker = TICKER_MAP[asset][market];
                for (const interval of Object.keys(TIMEFRAME_MAP)) {
                    const tf = TIMEFRAME_MAP[interval];
                    const tableName = `${asset}_${market}_${interval}`;
                    console.log(`[Connecting] ${tableName} -> ${rawTicker} [${tf}]`);
                    
                    try {
                        const klines = await extractTradingView(rawTicker, tf);
                        await processAndSaveData(client, tableName, klines);
                        await new Promise(res => setTimeout(res, 3000)); // Stealth delay
                    } catch (e) {
                        console.error(`[Failure] ${tableName}:`, e.message);
                    }
                }
            }
        }
    } finally {
        client.release();
        process.exit(0);
    }
}

async function extractTradingView(ticker, timeframe) {
    return new Promise((resolve, reject) => {
        let executionHalted = false;
        const client = new TradingView.Client();
        const chart = new client.Session.Chart();
        chart.setMarket(ticker, { timeframe, range: 50000 }); // GENESIS RANGE

        chart.onUpdate(() => {
            if (executionHalted) return; 
            if (!chart.periods || chart.periods.length < 50) return;

            executionHalted = true;
            const klines = chart.periods.reverse().map(p => ({
                timestamp: p.time * 1000, 
                open: p.open,
                high: p.max,
                low: p.min,
                close: p.close,
                volume: p.volume || 0
            }));

            client.end();
            resolve(klines);
        });

        setTimeout(() => {
            if (!executionHalted) {
                executionHalted = true;
                client.end();
                reject(new Error("Timeout pinging TradingView Socket"));
            }
        }, 15000);
    });
}

async function processAndSaveData(client, tableName, klines) {
    if (klines.length < 3) return;

    console.log(`    Wiping old DB table: ${tableName}...`);
    await client.query(`DELETE FROM ${tableName}`);

    const highList = klines.map(k => k.high);
    const lowList = klines.map(k => k.low);

    const sarResults = new PSAR({ high: highList, low: lowList, step: 0.02, max: 0.2 }).getResult();
    const sarResults2 = new PSAR({ high: highList, low: lowList, step: 0.01, max: 0.1 }).getResult();
    
    const sarOffset = klines.length - sarResults.length;
    const sarOffset2 = klines.length - sarResults2.length;
    const formattedValues = [];

    let prevS1 = 0, prevS3 = 0;

    for (let i = 0; i < klines.length; i++) {
        const kline = klines[i];
        let s1 = 0, s2 = 0, s3 = 0;

        if (i >= sarOffset) {
            s1 = sarResults[i - sarOffset]; 
            s2 = sarResults2[i - sarOffset2] || 0;
            
            if (prevS1 !== 0 && Math.abs(s1 - prevS1) > 0.000001) { s3 = s1; } else { s3 = prevS3; }
            if (s3 !== 0 && prevS1 !== 0 && Math.abs(s3 - prevS1) < 0.000001) s3 = 0;
            
            prevS1 = s1;
            prevS3 = s3;
        }

        let closePts = 0, closePct = 0;
        let prevClose = i > 0 ? klines[i - 1].close : kline.open;
        if (prevClose > 0) {
            closePts = kline.close - prevClose;
            closePct = (closePts / prevClose) * 100;
        }

        const id = `${tableName}_${kline.timestamp}`;
        formattedValues.push(`('${id}', ${kline.timestamp}, ${kline.open}, ${kline.high}, ${kline.low}, ${kline.close}, ${closePts}, ${closePct}, ${kline.volume}, ${s1}, ${s2}, ${s3})`);
    }

    const chunkSize = 1000;
    for (let i = 0; i < formattedValues.length; i += chunkSize) {
        const chunk = formattedValues.slice(i, i + chunkSize);
        await client.query(`
            INSERT INTO ${tableName} (id, timestamp, open, high, low, closevalue, closepts, closepct, closevol, sar1, sar2, sar3)
            VALUES ${chunk.join(',')}
        `);
    }

    // Auto-heal dirty historical Zero-Reset violations
    await client.query(`UPDATE ${tableName} SET sar3 = 0 WHERE sar3 = sar1 AND sar1 != 0`);

    console.log(`  ✔ [Synced] ${tableName} (${klines.length} genesis candles inserted)`);
}

run();
