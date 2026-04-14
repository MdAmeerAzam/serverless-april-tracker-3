const { pool } = require("../api/db");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
(async () => {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'gold_spot_daily'");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e.message);
    } finally {
        client.release();
        process.exit(0);
    }
})();
