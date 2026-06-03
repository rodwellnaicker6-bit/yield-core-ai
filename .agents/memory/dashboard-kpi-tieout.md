---
name: Dashboard KPI tie-out
description: How the executive KPI row stays consistent with the modules it summarizes
---
The dashboard stat row (renderStats in index.html) computes executive KPIs from the same
data the detail modules use (farmHealth, yieldFarms, carbonFarms, solarLive, alertsData,
carbonVCMPrice, ZAR_PER_USD) so the headline numbers match the modules.

**Rule:** any KPI that reads a value a module mutates must be (1) rendered AFTER that
module on first paint, and (2) re-rendered in lockstep whenever that module updates.

**Why:** solarLive is reassigned by renderSolar() and carbonVCMPrice is mutated by
renderCarbon(), both on intervals (5s solar, 30s carbon). If renderStats runs before them
or isn't re-run, the KPI row silently drifts from the Solar/Carbon modules — an
investor-visible inconsistency.

**How to apply:** in init() call renderStats() after renderSolar()+renderCarbon(); in the
5s and 30s intervals call renderStats(false) right after the module re-renders.
renderStats(animate) skips the count-up and the `fade` class when animate=false so the
lockstep re-render causes no flicker.
