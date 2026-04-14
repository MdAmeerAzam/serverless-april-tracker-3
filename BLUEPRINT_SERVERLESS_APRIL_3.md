# BLUEPRINT: Serverless April Tracker 3 (Cloud Macro)

This repository is a 100% standalone, high-precision financial monitoring infrastructure designed for Macro commodities tracking. It uses a **Deep Extractor** engine to pull direct TradingView data into a high-precision Supabase database and backs it up to Google Sheets.

## 1. Core Infrastructure & Links

- **GitHub Repository:** [serverless-april-tracker-3](https://github.com/MdAmeerAzam/serverless-april-tracker-3)
- **Primary Database:** Supabase (PostgreSQL) - 30 High-Precision Tables.
- **Google Sheet Destination:** [Cloud Macro High-Precision Sheet](https://docs.google.com/spreadsheets/d/1VytsJdr8EnKUXqxdMhvcDMzd9fCQowAPzayMWKKc4rA)
- **Data Source:** TradingView WebSockets (@mathieuc/tradingview).

## 2. Operating Terms (Frequency)

The system operates on a staggered 15-minute cycle to avoid API collisions and race conditions.

| Job Type | Frequency | Schedule (Minute) |
|----------|-----------|-------------------|
| **Cloud Sync** | Every 15 Minutes | 5, 20, 35, 50 |
| **Cloud Backup** | Every 15 Minutes | 10, 25, 40, 55 |

## 3. Mathematical Precision (The "Decimal Point" Rule)

To satisfy the requirement for absolute accuracy, the following standards are enforced:
- **Database Storage:** All numeric columns use `DECIMAL(24, 12)` (24 digits total, 12 after decimal).
- **SAR Logic:** 3-SAR Triple Engine with **Zero-Reset 3 Rule** (SAR 3 collapses to 0 on closed candles if it matches SAR 1, preventing "dirty" historical data).
- **Volume Restore:** The `closeVol` column is natively captured and restored (which was missing in the local build).

## 4. End-to-End Troubleshooting Check

If you suspect a sync gap, follow these steps to run a deep perimeter audit:

1.  **Database Audit:** Run the health explorer to check row parity.
    ```powershell
    cd "C:\Users\Ameer_Agent\Desktop\Antigravity\Serverless April Macro"
    node scripts/check_macro_db.js
    ```
2.  **TradingView Handshake:** Verify the WebSocket is connecting by running a single-market sync test:
    ```powershell
    node scripts/run_macro_sync.js
    ```
3.  **Sheet Reset:** If the Google Sheet data looks corrupted or misaligned, clear it and force a fresh resync:
    ```powershell
    node scripts/clear_macro_sheet.js
    node scripts/run_macro_backup.js
    ```

## 5. Failure Analysis (Why it might stop)

While the system is autonomous, monitor for these "Look Out" conditions:

- **1. TradingView Protocol Changes:** TradingView occasionally updates their WebSocket headers/authentication. If the `run_macro_sync.js` consistently throws "Timeout," the TV driver may need an update.
- **2. Google Sheets API Quota:** The Backup script pushes ~48,000 rows. If you see `429 Too Many Requests`, I have implemented a 1.1s pacing delay, but massive structural changes might trigger this limit.
- **3. GitHub Secrets Expiry:** If you change your Supabase password or Google Service Account, you **must** update the GitHub Secrets immediately or the Action will fail.

## 6. Dependencies Checklist (Pure & Standalone)
- [x] **No Share Policy:** Zero dependencies on `tracker-1` or `tracker-2`.
- [x] **Self-Contained:** Own `package.json` and own `node_modules`.
- [x] **Universal Decimals:** Native Postgres high-precision headers.

---
*Created: April 14, 2026 | Last Audit: 12:24 PM Local Time*
