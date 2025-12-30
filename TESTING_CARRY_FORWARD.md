# Testing the Carry-Forward Feature

## Quick Test Scenario

Follow these steps to see the carry-forward system in action:

### Scenario 1: Basic Carry-Forward

**Step 1: Add Previous Month Data**
1. Open the dashboard
2. Select the previous month from the month dropdown (e.g., November 2024)
3. Add some income:
   - Click the FAB (+ button)
   - Select "Add Income"
   - Add: Salary - 50,000
4. Add some expenses:
   - Click the FAB
   - Select "Add Expense"
   - Add: Shopping - 15,000
   - Add: Bills - 5,000
5. Previous month closing balance should be: 30,000

**Step 2: Check Current Month**
1. Switch to the current month (e.g., December 2024)
2. Refresh the page (F5)
3. Look at the "Recent Income" section
4. You should see a carry-forward entry:
   - Source: "Carry Forward"
   - Amount: 30,000
   - Badge: "AUTO" (blue badge)
   - Description: "Balance carried forward from November 2024"

**Step 3: Verify Protection**
1. Try to click the edit icon on the carry-forward transaction
   - Should show alert: "System-generated transactions cannot be edited."
2. Try to click the delete icon
   - Should show alert: "System-generated transactions cannot be deleted."

**Step 4: Verify Calculations**
1. Check "Total Income" KPI card
   - Should include the 30,000 carry-forward amount
2. Check "Available Balance"
   - Should reflect the carried-forward amount
3. All charts should include this amount in calculations

### Scenario 2: Negative Balance (No Carry-Forward)

**Step 1: Create Negative Balance**
1. Select previous month
2. Add Income: 10,000
3. Add Expenses: 15,000
4. Closing balance: -5,000 (negative)

**Step 2: Check Current Month**
1. Switch to current month
2. Refresh the page
3. No carry-forward transaction should appear
4. Only user-added income should show

### Scenario 3: Zero Balance (No Carry-Forward)

**Step 1: Create Zero Balance**
1. Select previous month
2. Add Income: 20,000
3. Add Expenses: 20,000
4. Closing balance: 0

**Step 2: Check Current Month**
1. Switch to current month
2. Refresh the page
3. No carry-forward transaction should appear

## Visual Verification Checklist

When a carry-forward transaction exists, verify:

- [ ] Transaction has light blue gradient background
- [ ] Left border is blue (3px solid)
- [ ] "AUTO" badge appears next to source name
- [ ] Badge has blue background with dark blue text
- [ ] Edit icon is grayed out and disabled
- [ ] Delete icon is grayed out and disabled
- [ ] Hovering over disabled icons shows "not-allowed" cursor
- [ ] Transaction appears in Recent Income list
- [ ] Amount is included in Total Income KPI
- [ ] Amount is included in Available Balance calculation

## Database Verification

To verify in Firestore Console:

### Check Income Collection
1. Open Firestore Console
2. Navigate to `income` collection
3. Find transactions with:
   - `isSystemGenerated: true`
   - `isCarryForward: true`
   - `source: "Carry Forward"`
   - `month: [current month]`
   - `date: [1st day of month]`

### Check Metadata Collection
1. Navigate to `metadata` collection
2. Look for document: `carry_forward_metadata`
3. Verify `processedMonths` object contains current month
4. Example:
   ```json
   {
     "processedMonths": {
       "2024-12": true,
       "2025-01": true
     },
     "lastUpdated": [timestamp]
   }
   ```

## Troubleshooting

### Issue: Carry-forward not appearing

**Solutions:**
1. Ensure previous month has both income and expenses
2. Verify previous month has positive closing balance
3. Check browser console for errors
4. Verify Firestore connection is working
5. Clear browser cache and refresh

### Issue: Duplicate carry-forwards

**Solutions:**
1. Check `metadata/carry_forward_metadata` document
2. Verify only one entry per month in `processedMonths`
3. If duplicates exist, delete extra transactions manually
4. Reset metadata for that month and refresh

### Issue: Can edit/delete carry-forward

**Solutions:**
1. Verify transaction has `isSystemGenerated: true` flag
2. Check component logic in `dashboard.component.ts`
3. Ensure HTML template has proper conditionals
4. Clear browser cache

## Developer Testing

### Console Commands

Open browser console and test:

```javascript
// Check if service is working
// (This requires exposing service for debugging)

// Manually trigger carry-forward check
await carryForwardService.checkAndProcessCarryForward('2025-01')

// Reset a month for retesting
await carryForwardService.resetCarryForwardForMonth('2025-01')

// Check metadata
// Go to Firestore Console and view metadata/carry_forward_metadata
```

### Test Different Months

1. Test with January (previous year December)
2. Test with December (previous year November)
3. Test consecutive months
4. Test skipping months

### Edge Case Testing

1. **First user (no previous data)**
   - Should work without errors
   - No carry-forward created

2. **Multiple rapid refreshes**
   - Should not create duplicates
   - Metadata should prevent reprocessing

3. **Month navigation**
   - Switch between months multiple times
   - Carry-forward should remain stable

4. **Adding data to previous month after carry-forward**
   - Previous month data changes
   - Current month carry-forward remains unchanged
   - (Carry-forward is snapshot at creation time)

## Success Criteria

The feature is working correctly when:

1. Positive previous month balance creates carry-forward
2. Carry-forward appears on 1st of current month
3. Transaction is clearly marked as system-generated
4. Users cannot modify system-generated transactions
5. No duplicate carry-forwards exist
6. All calculations include carry-forward amount
7. System works across page refreshes
8. Metadata correctly tracks processed months
9. Visual indicators are clear and professional
10. Error handling works gracefully

---

**Need Help?**
- Check browser console for errors
- Review Firestore data structure
- Verify service initialization in dashboard component
- Ensure Firebase connection is working
- Check network tab for Firestore operations
