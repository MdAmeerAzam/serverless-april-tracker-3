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

const TIMEFRAME_MAP = { daily: '1D', weekly: '1W', monthly: '1M' };

async function run() {
    console.log("[Genesis Engine] Initializing True Macro Math Engine...");
    let client;
    for (let attempts = 0; attempts < 10; attempts++) {
        try {
            client = await pool.connect();
            break;
        } catch (e) {
            console.log(`[Supabase] Connection saturated, retrying in 5 seconds... (${e.message})`);
            await new Promise(res => setTimeout(res, 5000));
        }
    }
    if (!client) throw new Error("Failed to connect to Supabase after 10 attempts.");
    
    try {
        for (const asset of Object.keys(TICKER_MAP)) {
            for (const market of ['spot', 'futures']) {
                const rawTicker = TICKER_MAP[asset][market];
                for (const interval of Object.keys(TIMEFRAME_MAP)) {
                    const tf = TIMEFRAME_MAP[interval];
                    const tableName = `${asset}_${market}_${interval}`;
                    console.log(`[Genesis] ${tableName} -> ${rawTicker} [${tf}]`);
                    
                    try {
                        const klines = await extractMaxTradingView(rawTicker, tf);
                        await healDatabase(client, tableName, klines);
                        await new Promise(res => setTimeout(res, 3000));
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

async function extractMaxTradingView(ticker, timeframe) {
    return new Promise((resolve, reject) => {
        let executionHalted = false;
        const client = new TradingView.Client();
        const chart = new client.Session.Chart();
        // Request max possible historical range to perfectly warm up SAR 2 (0.01)
        chart.setMarket(ticker, { timeframe, range: 5000 }); 

        chart.onUpdate(() => {
            if (executionHalted) return; 
            if (!chart.periods || chart.periods.length < 50) return;

            executionHalted = true;
            const klines = chart.periods.reverse().map(p => ({
                timestamp: p.time * 1000, 
                high: p.max,
                low: p.min,
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

async function healDatabase(client, tableName, klines) {
    if (klines.length < 3) return;

    const highList = klines.map(k => k.high);
    const lowList = klines.map(k => k.low);
    const sarResults2 = new PSAR({ high: highList, low: lowList, step: 0.01, max: 0.1 }).getResult();
    const sarOffset2 = klines.length - sarResults2.length;
    
    const healQueue = [];
    for (let i = sarOffset2; i < klines.length; i++) {
        const timestamp = klines[i].timestamp;
        const s2 = sarResults2[i - sarOffset2];
        const id = `${tableName}_${timestamp}`;
        healQueue.push(`('${id}', ${s2})`);
    }

    if (healQueue.length === 0) return;

    // Supabase Egress Protection: We only UPDATE where sar2 is broken or missing.
    // We use a temporary table architecture to join and selectively update en masse.
    await client.query(`
        CREATE TEMP TABLE temp_heal_${tableName} (id text, calc_sar2 numeric) ON COMMIT DROP;
    `);

    const chunkSize = 2000;
    for (let i = 0; i < healQueue.length; i += chunkSize) {
        const chunk = healQueue.slice(i, i + chunkSize);
        await client.query(`INSERT INTO temp_heal_${tableName} (id, calc_sar2) VALUES ${chunk.join(',')}`);
    }

    const { rowCount } = await client.query(`
        UPDATE ${tableName} 
        SET sar2 = temp.calc_sar2
        FROM temp_heal_${tableName} temp
        WHERE ${tableName}.id = temp.id AND ${tableName}.sar2 = 0
    `);

    console.log(`  ✔ [Healed] ${tableName}: ${rowCount} algorithm deaths restored.`);
}

run();
