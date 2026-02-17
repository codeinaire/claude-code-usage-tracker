# Billing Cycle Navigation

## Context

The BillingCycleDropdown currently only supports viewing the **current** billing period or **all data** - there's no middle ground. Users want to:
1. Browse past billing cycles to see historical usage per period
2. Select multiple billing cycles at once for trend analysis and cumulative subscription comparisons

This is a frontend-only change to `BillingCycleDropdown.tsx`. No backend or API changes needed - the existing `onReset(from, to)` callback already accepts arbitrary date ranges.

## Changes

**Single file modified:** `src/client/components/BillingCycleDropdown.tsx`

### 1. Generalize `getBillingCycle` to support offsets

Replace `getBillingCycle(startDate)` with `getBillingCycleForOffset(startDate, offset)` where offset is 0 for current cycle, -1 for previous, -2 for two back, etc. The logic stays the same but applies an offset to the period start month before computing boundaries.

### 2. Add state variables

- `cycleOffset` (number, default 0) - which cycle is focused (0 = current, -1 = previous, etc.)
- `cycleCount` (number, default 1) - how many cycles to view at once

### 3. Add cycle navigation UI

Inside the dropdown menu, after the subscription date input:

- **Prev/Next arrows** with a "Now" button to jump back to current cycle
- **Period display** showing the focused cycle's date range (e.g., "Feb 15 - Mar 14") with a "(current)" indicator when on offset 0
- **Cycle range selector** - buttons for [1] [2] [3] [6] [12] cycles (matching the quick-select pattern from DateRangePicker)
- **Full range display** (when count > 1) showing the combined range
- **Next Payment** shown only when viewing the current cycle

### 4. Update action buttons

- "Reset to Current Period" becomes dynamic: "View Current Period" / "View This Period" / "View N Cycles" depending on state
- "Show All Data" unchanged
- "Clear Start Date" also resets cycleOffset and cycleCount

### 5. Boundary guards

- Disable the "previous" arrow when the range would start before the subscription start date
- Disable the "next" arrow when already at the current cycle (offset 0)
- When changing cycle count, clamp offset forward if the expanded range would extend before the subscription date

### 6. Reset on date change

When saving a new subscription date or clearing it, reset `cycleOffset` to 0 and `cycleCount` to 1.

## UI Layout

```
+------------------------------------------+
| SUBSCRIPTION START DATE                  |
| [  date input  ] [ Save ]               |
|------------------------------------------|
| BILLING PERIOD            [<]  [>] [Now] |
| Feb 15 - Mar 14 (current)               |
|                                          |
| CYCLE RANGE                              |
| [1] [2] [3] [6] [12]  cycles            |
| Full range: Dec 15 - Mar 14             |
|                                          |
| NEXT PAYMENT                             |
| Mar 15                                   |
|------------------------------------------|
| [  View 3 Cycles         ]              |
| [  Show All Data          ]             |
| [  Clear Start Date       ]             |
+------------------------------------------+
```

## Implementation Checklist

- [ ] Replace `getBillingCycle` with `getBillingCycleForOffset(startDate, offset)` supporting cycle offsets
- [ ] Add `cycleOffset` and `cycleCount` state variables
- [ ] Add new styles (`navRow`, `navButton`, `navButtonDisabled`, `cycleCountRow`, `cycleCountButton`, `cycleCountButtonActive`)
- [ ] Add prev/next/now navigation buttons with boundary guards
- [ ] Add focused cycle period display with "(current)" indicator
- [ ] Add cycle range selector buttons ([1] [2] [3] [6] [12])
- [ ] Add full range display when cycleCount > 1
- [ ] Show "Next Payment" only when viewing current cycle (offset 0)
- [ ] Update primary action button text to be dynamic ("View Current Period" / "View This Period" / "View N Cycles")
- [ ] Update `handleReset` to compute date range from cycleOffset + cycleCount
- [ ] Reset cycleOffset and cycleCount when saving/clearing subscription date
- [ ] Clamp offset when cycle count changes to avoid going before subscription start
- [ ] Build passes (`npm run build`)
- [ ] Manual testing complete

## Verification

1. `npm run build` - no TypeScript errors
2. Manual testing:
   - Set subscription date, verify current period displays correctly
   - Navigate backward/forward with arrows, verify dates shift by one cycle
   - Verify prev arrow disables at subscription start boundary
   - Verify next arrow disables at current cycle
   - Select multi-cycle count, verify "Full range" updates
   - Click "View N Cycles", verify dashboard filters to the combined range
   - Click "Show All Data", verify filters clear
   - Clear start date, verify state resets
