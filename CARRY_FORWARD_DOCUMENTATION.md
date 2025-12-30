# Automatic Monthly Carry-Forward System

## Overview

The application now includes an automatic monthly carry-forward system that ensures financial continuity across months. When a month ends with a positive balance, that balance is automatically carried forward as income to the next month.

## How It Works

### 1. Automatic Detection
When the dashboard loads, the system checks if the current month needs a carry-forward transaction from the previous month.

### 2. Balance Calculation
The system calculates the previous month's closing balance:
- **Closing Balance** = Total Income - Total Expenses

### 3. Carry-Forward Creation
If the closing balance is positive (> 0), the system automatically creates a credit transaction on the 1st day of the new month with:
- **Category**: "Carry Forward"
- **Source**: "Carry Forward"
- **Description**: "Balance carried forward from [Previous Month Year]"
- **Amount**: Previous month's remaining balance
- **Date**: 1st day of the current month
- **Flags**:
  - `isSystemGenerated: true` - Marks as system-created
  - `isCarryForward: true` - Identifies as carry-forward transaction

### 4. Duplicate Prevention
The system maintains metadata in Firestore to track which months have been processed. This ensures:
- No duplicate carry-forward transactions
- Each month is processed only once
- System remains consistent across page refreshes

## User Experience

### Visual Indicators
System-generated carry-forward transactions are visually distinguished in the Recent Income section:
- Soft blue gradient background
- Blue left border accent
- "AUTO" badge next to the source name
- Grayed out edit/delete icons

### Protection Against Editing
Users cannot edit or delete system-generated transactions:
- Edit and delete actions are disabled for carry-forward entries
- Attempting to modify them shows an alert message
- This ensures data integrity and accurate financial tracking

### Integration with Calculations
Carry-forward transactions are included in:
- Total Income calculations
- Available Balance calculations
- Recent Income display
- Monthly financial summaries

## Technical Implementation

### Service Architecture

**CarryForwardService** (`carry-forward.service.ts`)
- Handles all carry-forward logic
- Checks if processing is needed
- Creates carry-forward transactions
- Maintains processing metadata
- Provides reset functionality for debugging

### Key Methods

```typescript
checkAndProcessCarryForward(currentMonth: string)
```
Main entry point that orchestrates the entire carry-forward process.

```typescript
createCarryForwardTransaction(currentMonth, previousMonth, amount)
```
Creates the actual carry-forward income transaction with proper metadata.

```typescript
isCarryForwardProcessed(month: string)
```
Checks if a month has already been processed to prevent duplicates.

```typescript
markCarryForwardProcessed(month: string)
```
Records that a month has been processed in Firestore metadata.

### Data Schema

**Income Transaction with Carry-Forward**:
```typescript
{
  source: "Carry Forward",
  amount: number,
  description: "Balance carried forward from [Month Year]",
  date: Timestamp,
  month: "YYYY-MM",
  isSystemGenerated: true,
  isCarryForward: true,
  createdAt: Timestamp
}
```

**Metadata Document**:
```typescript
{
  processedMonths: {
    "2024-12": true,
    "2025-01": true,
    // ...
  },
  lastUpdated: Timestamp
}
```

## Business Rules

1. Only positive balances are carried forward
2. Zero or negative balances do not create carry-forward transactions
3. Each month can only have one carry-forward transaction
4. Carry-forward always occurs on the 1st day of the month
5. System-generated transactions cannot be modified by users
6. The previous month must have both income and expense data to calculate balance

## Edge Cases Handled

- First-time users with no previous month data
- Months with zero or negative balances
- Multiple page refreshes or app loads
- Direct navigation to different months
- Data consistency across browser sessions

## Maintenance & Debugging

### Reset Carry-Forward for a Month
If needed, the service includes a reset method:
```typescript
carryForwardService.resetCarryForwardForMonth('2025-01')
```
This will:
- Remove existing carry-forward transactions for that month
- Clear the processed flag in metadata
- Allow the system to reprocess if needed

### Monitoring
- Check Firestore collection `metadata/carry_forward_metadata` for processing status
- Review income transactions with `isCarryForward: true` flag
- Verify amounts match previous month's closing balance

## Future Enhancements

Potential improvements for future versions:
1. Admin panel to view/manage carry-forward history
2. Detailed audit log of all carry-forward operations
3. Notification when carry-forward is created
4. Option to manually adjust carry-forward amounts
5. Support for negative balance carry-forward (debt tracking)
6. Multi-currency carry-forward support

## Security Considerations

- System-generated flag prevents accidental user modification
- Firestore security rules should restrict metadata collection access
- Carry-forward logic runs client-side but can be migrated to Cloud Functions
- All operations are idempotent to prevent data corruption

## Performance

- Minimal impact on dashboard load time
- Metadata checks are efficient single-document reads
- Processing only occurs once per month per user
- No recurring background jobs required
- Scales naturally with user base

---

**Implementation Date**: December 2025
**Version**: 1.0
**Status**: Production Ready
