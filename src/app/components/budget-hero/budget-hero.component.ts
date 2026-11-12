import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BudgetSummary } from '../../utils/budget.util';

/**
 * Overview's first card: how much of this month's money is used, and what's safe to spend.
 * Everything else on Overview is detail behind these numbers.
 */
@Component({
  selector: 'app-budget-hero',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  template: `
    @if (s; as s) {
      <section class="hero" [class]="'pace-' + s.pace" aria-label="Budget this month">
        <div class="top">
          <div class="spent">
            <span class="label">{{ s.isCurrentMonth ? 'Spent so far' : s.isFuture ? 'Planned so far' : 'Spent' }} · {{ monthLabel }}</span>
            <span class="big">₹{{ s.spent | number: '1.0-0' }}</span>
            <span class="of">
              @if (s.income > 0) { of ₹{{ s.income | number: '1.0-0' }} income · <strong>{{ s.usedPercent }}% used</strong> }
              @else { No income recorded for this month yet }
            </span>
          </div>
          <div class="balance" [class.neg]="s.balance < 0">
            <span class="label">{{ s.balance < 0 ? 'Overspent' : 'Left' }}</span>
            <span class="mid">₹{{ (s.balance < 0 ? -s.balance : s.balance) | number: '1.0-0' }}</span>
          </div>
        </div>

        @if (s.income > 0) {
          <div class="meter" role="progressbar" [attr.aria-valuenow]="s.usedPercent" aria-valuemin="0" aria-valuemax="100"
               [attr.aria-label]="s.usedPercent + '% of income used'">
            <span class="used" [style.width.%]="s.usedPercent > 100 ? 100 : s.usedPercent"></span>
            @if (s.isCurrentMonth) {
              <span class="today-mark" [style.left.%]="s.monthPercent" [title]="s.monthPercent + '% of the month has passed'"></span>
            }
          </div>
          <p class="pace-text">
            @switch (s.pace) {
              @case ('under') { 👍 You're spending slower than the month is passing. }
              @case ('on') { ⚖️ Spending is in step with the month. }
              @case ('over') { ⚠️ Spending is ahead of the month — {{ s.usedPercent }}% used with {{ s.monthPercent }}% of the month gone. }
            }
          </p>
        }

        <div class="facts">
          @if (s.isCurrentMonth) {
            <div><span>Safe to spend / day</span><strong>₹{{ s.safePerDay | number: '1.0-0' }}</strong><small>for {{ s.daysLeft }} day{{ s.daysLeft === 1 ? '' : 's' }}</small></div>
            <div><span>Month-end at this pace</span><strong [class.warn]="s.income > 0 && s.projected > s.income">₹{{ s.projected | number: '1.0-0' }}</strong></div>
          }
          <div><span>Daily average</span><strong>₹{{ s.dailyAverage | number: '1.0-0' }}</strong></div>
          <div>
            <span>vs last month{{ s.isCurrentMonth ? ' (same day)' : '' }}</span>
            <strong [class.warn]="s.vsLastMonth > 0" [class.good]="s.vsLastMonth < 0">
              {{ s.vsLastMonth > 0 ? '+' : s.vsLastMonth < 0 ? '−' : '' }}₹{{ (s.vsLastMonth < 0 ? -s.vsLastMonth : s.vsLastMonth) | number: '1.0-0' }}
            </strong>
          </div>
        </div>

        <div class="split">
          <span>🧾 Expenses <strong>₹{{ s.expenseSpend | number: '1.0-0' }}</strong></span>
          <a routerLink="/cards/transactions">💳 Card spends <strong>₹{{ s.cardSpend | number: '1.0-0' }}</strong></a>
          @if (s.cardBillsPaid > 0) {
            <span class="muted" title="Card bill payments aren't counted — the card purchases already are">Card bills paid ₹{{ s.cardBillsPaid | number: '1.0-0' }} (not counted twice)</span>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .hero { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; border-radius: 22px; color: #fff;
      background: linear-gradient(135deg, #115e59, #0f172a); box-shadow: 0 14px 40px rgba(15,23,42,.18); }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .spent, .balance { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .balance { align-items: flex-end; text-align: right; }
    .label { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #99f6e4; }
    .big { font-size: 34px; font-weight: 800; letter-spacing: -1px; line-height: 1.1; }
    .mid { font-size: 24px; font-weight: 800; letter-spacing: -.5px; color: #5eead4; }
    .balance.neg .mid { color: #fca5a5; }
    .of { font-size: 14px; color: #cbd5e1; }
    .of strong { color: #fff; }
    .meter { position: relative; height: 12px; border-radius: 999px; background: rgba(255,255,255,.16); overflow: visible; }
    .used { display: block; height: 100%; border-radius: inherit; background: #2dd4bf; transition: width .4s; }
    .pace-over .used { background: #f87171; }
    .today-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #fff; border-radius: 2px; transform: translateX(-1px); }
    .pace-text { margin: -4px 0 0; font-size: 13px; color: #e2e8f0; }
    .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .facts div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,.08); }
    .facts span { font-size: 12px; color: #cbd5e1; }
    .facts strong { font-size: 17px; }
    .facts small { font-size: 11px; color: #94a3b8; }
    .warn { color: #fca5a5; }
    .good { color: #86efac; }
    .split { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: #cbd5e1; }
    .split a { color: inherit; text-decoration: none; }
    .split strong { color: #fff; }
    .split .muted { color: #94a3b8; }
    @media (max-width: 760px) {
      .hero { padding: 16px; border-radius: 18px; }
      .big { font-size: 28px; }
      .mid { font-size: 20px; }
      .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `],
})
export class BudgetHeroComponent {
  @Input() s: BudgetSummary | null = null;
  @Input() monthLabel = '';
}
