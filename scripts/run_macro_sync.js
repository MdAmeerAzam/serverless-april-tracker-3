const TradingView = require('@mathieuc/tradingview');
const { PSAR } = require('technicalindicators');
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
    console.log("[Deep Extractor] Initializing Standalone TradingView Handshake...");
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
        chart.setMarket(ticker, { timeframe, range: 2000 }); 

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

    // Fetch existing SAR data for history continuity (Limited to active 200-candle window)
    const minTimestamp = klines[0].timestamp;
    const { rows: existingRows } = await client.query(
        `SELECT timestamp, sar1, sar2, sar3 FROM ${tableName} WHERE timestamp >= $1 ORDER BY timestamp ASC`,
        [minTimestamp]
    );
    const existingSarMap = new Map();
    existingRows.forEach(r => existingSarMap.set(String(r.timestamp), r));

    const highList = klines.map(k => k.high);
    const lowList = klines.map(k => k.low);

    const sarResults = new PSAR({ high: highList, low: lowList, step: 0.02, max: 0.2 }).getResult();
    const sarResults2 = new PSAR({ high: highList, low: lowList, step: 0.01, max: 0.1 }).getResult();
    
    const sarOffset = klines.length - sarResults.length;
    const sarOffset2 = klines.length - sarResults2.length;

    for (let i = 0; i < klines.length; i++) {
        const kline = klines[i];
        const isLiveCandle = (i === klines.length - 1);
        let s1 = 0, s2 = 0, s3 = 0;

        if (i >= sarOffset) {
            const currentCalcSar = sarResults[i - sarOffset]; 
            const currentS2 = sarResults2[i - sarOffset2] || 0;
            const existing = existingSarMap.get(String(kline.timestamp));

            if (existing) {
                const oldHistoricalS1 = Number(existing.sar1);
                s1 = oldHistoricalS1 !== 0 ? oldHistoricalS1 : currentCalcSar;
                s2 = currentS2;

                if (isLiveCandle) {
                    s3 = (Math.abs(currentCalcSar - oldHistoricalS1) > 0.000001 && oldHistoricalS1 !== 0) ? currentCalcSar : 0;
                } else {
                    const frozenS3 = Number(existing.sar3);
                    s3 = (frozenS3 !== 0 && Number(existing.sar1) !== 0 && Math.abs(frozenS3 - Number(existing.sar1)) < 0.000001) ? 0 : frozenS3;
                }
            } else {
                s1 = currentCalcSar;
                s2 = currentS2;
                s3 = 0;
            }
        }

        let closePts = 0, closePct = 0;
        let prevClose = i > 0 ? klines[i - 1].close : kline.open;
        if (prevClose > 0) {
            closePts = kline.close - prevClose;
            closePct = (closePts / prevClose) * 100;
        }

        const id = `${tableName}_${kline.timestamp}`;
        await client.query(`
            INSERT INTO ${tableName} (id, timestamp, open, high, low, closevalue, closepts, closepct, closevol, sar1, sar2, sar3)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
                open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                closevalue = EXCLUDED.closevalue, closepts = EXCLUDED.closepts,
                closepct = EXCLUDED.closepct, closevol = EXCLUDED.closevol,
                sar1 = EXCLUDED.sar1, sar2 = EXCLUDED.sar2, sar3 = EXCLUDED.sar3
        `, [id, kline.timestamp, kline.open, kline.high, kline.low, kline.close, closePts, closePct, kline.volume, s1, s2, s3]);
    }
    console.log(`  ✔ [Synced] ${tableName}`);
}

run();
