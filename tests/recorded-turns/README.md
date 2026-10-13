# Recorded turns

Auto-fill turns saved from the panel's flask button (GM only). Each file is a planner
quality-lab scenario: the planning context and scored candidates as plain JSON, plus the GM's
verdict (which plan should rank first, or which plan must not).

`npm run planner:quality` and `node scripts/engine/self-test.js` replay every file here.
A recorded "Auto-fill was wrong" turn fails until the planner is fixed; that's the point.
