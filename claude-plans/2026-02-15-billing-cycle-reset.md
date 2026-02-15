# Plan: Subscription Billing Cycle Reset

## Context
Users want to track their Claude usage per billing cycle. By entering their subscription start date, the app calculates the current billing period and next payment date. When a new billing cycle begins, users can "reset" the view to only show the current period's data, or continue seeing all data. This is implemented as a dropdown next to the existing Export button.

## Changes

### 1. Database: Add `settings` table
**File:** `src/server/db/schema.ts`
- Add a `settings` table (key TEXT PRIMARY KEY, value TEXT) to `initializeSchema()`
- Simple key/value store for app settings like `subscription_start_date`

### 2. Backend: Settings queries
**File:** `src/server/db/queries.ts`
- Add `getSetting(key)` and `setSetting(key, value)` functions

### 3. Backend: Settings API routes
**File:** `src/server/routes/settings.ts` (new)
- `GET /api/settings` - returns all settings
- `PUT /api/settings/subscription-start-date` - saves the subscription start date (body: `{ date: "2025-01-15" }`)
- Register in `src/server/index.ts`

### 4. Frontend: Billing Cycle dropdown component
**File:** `src/client/components/BillingCycleDropdown.tsx` (new)
- Dropdown button styled like the existing export button, placed next to it
- States:
  - **No date set:** Shows date input to set subscription start date
  - **Date set:** Shows current billing period (e.g., "Jan 15 - Feb 14"), next payment date, and two actions:
    - "Reset to current period" - calls `onReset(fromDate)` which sets the date range filter in Dashboard
    - "Show all data" - calls `onClear()` which clears the date filter
  - Edit/clear the saved date
- Billing cycle calculation: given start day-of-month, the current period starts on that day of the current (or previous) month

### 5. Frontend: Wire into Dashboard
**File:** `src/client/components/Dashboard.tsx`
- Import and render `BillingCycleDropdown` next to the export button in the actions bar
- Connect its `onReset` callback to set `dateRange` (from = billing period start, to = today)
- Connect its `onClear` callback to clear `dateRange`

## Billing Cycle Logic
- User sets start date (e.g., Jan 15)
- Extract the day-of-month (15th)
- Current period start: if today >= the day this month, it's this month's day; otherwise last month's day
- Current period end / next payment: the day of the following month
- Example: start date Jan 15, today is Feb 15 → current period is Feb 15 - Mar 14, next payment Mar 15

## Verification
1. Run `npm run build` to verify no TypeScript errors
2. Start the dev server and verify:
   - Dropdown appears next to Export button
   - Can set subscription start date (persists on refresh)
   - Shows correct billing period dates
   - "Reset to current period" filters the dashboard to the billing period
   - "Show all data" clears the filter
   - Can change or clear the saved date
