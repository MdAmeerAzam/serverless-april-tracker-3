# BLUEPRINT: Cloud Macro WATCHDOG (Serverless)

The Cloud Macro Watchdog is a heavy-duty, autonomous monitoring agent that audits the mathematical integrity and sync timing of the `serverless-april-tracker-3` (Macro build).

## 1. Operating Terms
The Watchdog runs independently at a lower frequency than the Sync engine to provide impartial oversight.

- **Platform:** GitHub Actions (Serverless)
- **Schedule:** Automated audit every **4 hours**.
- **Alerting:** Triggers a **GitHub Action Failure** (and email alert) if any anomaly is detected.

## 2. Audit Heuristics (The "Eyes")

The Watchdog performs deep-packet inspections on the last 7 candles of every Macro table:

| Check | Hazard Flag | Hazard Meaning |
|-------|-------------|----------------|
| **Macro Sync Gap** | `Latest Candle > 1.5 intervals` | **Sync Deficit:** The daily/weekly/monthly flow has stalled. |
| **Genesis Lock** | `SAR 1 == 0` | **Data Corruption:** Historical anchor points were wiped or corrupted. |
| **SAR Reset Logic** | `isClosed && SAR 3 == SAR 1` | **Math Violation:** High-precision Zero-Reset rule failed to apply. |
| **Algo Death** | `All 7 rows: SAR 2 == 0` | **Engine Failure:** Decelerated baseline is not calculating. |

## 3. High-Precision Verification
Because this is a Macro build, the Watchdog uses `0.000001` precision thresholds to ensure it detects even the smallest decimal drift in the database.

---
*Created: April 14, 2026*
