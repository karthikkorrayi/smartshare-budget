import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { CardWithPosition } from '../../services/card-insights.service';
import { CardStatementsService } from '../../services/card-statements.service';
import { UndoService } from '../../services/undo.service';
import { AUTOPAY_LABEL, NETWORK_LABEL, REWARD_LABEL, TIER_LABEL, benefitLabel, billingCycle, expiryInfo, usageTone } from '../../models/card.model';
import { dueInfo } from '../../models/card-statement.model';
import { IconComponent } from '../../ui/icon.component';
import { AmountComponent } from '../../ui/amount.component';
import { MoneyPipe } from '../../ui/money.pipe';

/**
 * A credit card's own overview: limit usage, billing cycle, latest statement, costs, rewards and
 * benefits. All figures come from CardInsightsService.cardPosition, the same numbers the dashboard
 * and the Cards page use. Sections with no data offer to fill it in (opens the card form at that step).
 */
@Component({
  selector: 'app-card-overview',
  standalone: true,
  imports: [DatePipe, IconComponent, AmountComponent, MoneyPipe],
  template: `
    @let c = d().card;
    @let p = d().pos;
    <div class="co">
      <!-- Limit -->
      <section class="panel limit">
        <div class="panel-head">
          <div><h2>Credit limit</h2><p>{{ p.limit ? 'Used = unpaid statements + spends since the last statement' : 'Add the limit to see what you can still spend' }}</p></div>
          @if (p.overLimit) { <span class="badge neg"><app-icon name="alert-triangle" [size]="13" />Over limit</span> }
          @else if (p.usedPct !== null) { <span class="badge" [class]="'badge ' + tone()">{{ p.usedPct }}% used</span> }
        </div>
        @if (p.limit) {
          <div class="meter" role="progressbar" [attr.aria-valuenow]="p.usedPct" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="p.usedPct + '% of the limit used'">
            <span class="billed" [style.width.%]="pct(p.billed)"></span>
            <span class="unbilled" [style.width.%]="pct(p.unbilled)"></span>
            @if (c.utilAlertPct) { <span class="alert-mark" [style.left.%]="c.utilAlertPct" [title]="'Alert at ' + c.utilAlertPct + '%'"></span> }
          </div>
          <div class="figs">
            <div><span class="k"><i class="sw billed"></i>Billed</span><app-amount [value]="p.billed" [privacyKey]="'card:' + c.id + ':billed'" label="Billed" /></div>
            <div><span class="k"><i class="sw unbilled"></i>Unbilled</span><app-amount [value]="p.unbilled" [privacyKey]="'card:' + c.id + ':unbilled'" label="Unbilled" /></div>
            <div><span class="k">Available</span><app-amount [value]="p.available" [privacyKey]="'card:' + c.id + ':available'" [signed]="true" label="Available limit" /></div>
            <div><span class="k">Limit</span><app-amount [value]="p.limit" [privacyKey]="'card:' + c.id + ':limit'" label="Credit limit" /></div>
          </div>
          <p class="tip" [class]="'tip ' + tone()"><app-icon [name]="tone() === 'pos' ? 'circle-check' : 'info'" [size]="14" />
            <span>{{ tone() === 'pos' ? 'Healthy — staying under 30% of the limit helps your credit score.' : tone() === 'warn' ? 'Moderate usage. Paying down before the statement keeps your score healthy.' : 'High usage. Pay part of it now to bring it under 30%.' }}
            @if (c.cashLimit) { Cash limit {{ c.cashLimit | money }}. }</span></p>
        } @else {
          <div class="empty-row"><app-icon name="target" [size]="18" /><span>Owed now: <app-amount [value]="p.used" [privacyKey]="'card:' + c.id" label="Owed" /></span>
            <button class="btn btn-sm" (click)="edit.emit(1)"><app-icon name="plus" [size]="14" />Add limit</button></div>
        }
      </section>

      <!-- Billing cycle -->
      <section class="panel">
        <div class="panel-head"><div><h2>Billing cycle</h2><p>Statement on the {{ ord(c.statementDay) }} · due on the {{ ord(c.dueDay) }}</p></div>
          <span class="badge info"><app-icon name="repeat" [size]="13" />Autopay: {{ autopay[c.autopay] }}</span></div>
        <div class="cycle">
          <div class="cbar"><span [style.width.%]="cyc().cycleProgress"></span></div>
          <div class="crow">
            <div><span class="k">Cycle</span><b>{{ cyc().cycleStart | date: 'd MMM' }} – {{ cyc().nextStatement | date: 'd MMM' }}</b></div>
            <div><span class="k">Spent this cycle</span><b><app-amount [value]="p.cycleSpend" [privacyKey]="'card:' + c.id + ':cycle'" label="Spent this cycle" /></b></div>
            <div><span class="k">Free days today</span><b>{{ cyc().freeDays }} <small>of {{ cyc().maxFreeDays }}</small></b></div>
          </div>
        </div>
        @if (p.lastStatement; as s) {
          @let info = due(s);
          <div class="stmt" [attr.data-tone]="info.tone">
            <div class="grow">
              <span class="k">Latest statement · {{ s.statementDate | date: 'd MMM y' }}</span>
              <b>{{ s.totalDue | money }}</b> <small>min {{ s.minDue | money }} · paid {{ s.paidAmount | money }}</small>
              <span class="due"><app-icon name="calendar-clock" [size]="13" />{{ info.text }} · {{ s.dueDate | date: 'd MMM' }}</span>
            </div>
            @if (s.status !== 'Paid') {
              <button class="btn btn-sm btn-primary" (click)="markPaid()" [disabled]="busy()"><app-icon name="check" [size]="14" />Mark paid</button>
            }
          </div>
          @if (p.interestIfMinimum) {
            <p class="tip warn"><app-icon name="alert-triangle" [size]="14" /><span>Paying only the minimum ({{ p.minDue | money }}) costs about <b>{{ p.interestIfMinimum | money }}</b> interest next month at {{ c.interestMonthly }}% a month.</span></p>
          }
        } @else {
          <p class="muted tiny">No statement recorded yet{{ c.openingOutstanding ? ' — using the outstanding you entered (' + (c.openingAsOf ? 'as of ' + (c.openingAsOf | date: 'd MMM') : 'opening') + ')' : '' }}.</p>
        }
      </section>

      <!-- Costs -->
      <section class="panel">
        <div class="panel-head"><div><h2>Costs</h2><p>Interest and fees on this card</p></div>
          <button class="btn btn-sm btn-ghost" (click)="edit.emit(2)"><app-icon name="pencil" [size]="14" />Edit</button></div>
        @if (hasCosts()) {
          <dl class="kv">
            @if (c.interestMonthly) { <dt>Interest</dt><dd>{{ c.interestMonthly }}% a month <small class="muted">≈ {{ round(c.interestMonthly * 12) }}% a year</small></dd> }
            <dt>Annual fee</dt><dd>{{ c.annualFee ? (c.annualFee | money) : 'None' }}</dd>
            @if (c.lateFee) { <dt>Late payment fee</dt><dd>{{ c.lateFee | money }}</dd> }
            @if (c.cashAdvanceFeePct) { <dt>Cash withdrawal</dt><dd>{{ c.cashAdvanceFeePct }}% fee</dd> }
            @if (c.forexMarkupPct) { <dt>Foreign currency</dt><dd>{{ c.forexMarkupPct }}% markup</dd> }
          </dl>
          @if (p.waiverPct !== null && c.annualFee) {
            <div class="waiver">
              <div class="wtop"><span>Fee waiver: {{ p.yearSpend | money }} of {{ c.feeWaiverSpend | money }} in the last 12 months</span><b>{{ p.waiverPct }}%</b></div>
              <div class="cbar"><span [style.width.%]="p.waiverPct" [class.done]="p.waiverPct >= 100"></span></div>
            </div>
          }
        } @else {
          <div class="empty-row"><app-icon name="percent" [size]="18" /><span>Add interest and fees to see what carrying a balance would cost.</span>
            <button class="btn btn-sm" (click)="edit.emit(2)"><app-icon name="plus" [size]="14" />Add</button></div>
        }
      </section>

      <!-- Rewards & benefits -->
      <section class="panel">
        <div class="panel-head"><div><h2>Rewards &amp; benefits</h2><p>{{ c.rewardType === 'none' ? 'No rewards set' : reward().label + (c.rewardRate ? ' · ' + c.rewardRate + (c.rewardType === 'cashback' ? '%' : ' per ₹100') : '') }}</p></div>
          <button class="btn btn-sm btn-ghost" (click)="edit.emit(2)"><app-icon name="pencil" [size]="14" />Edit</button></div>
        @if (c.rewardType !== 'none') {
          <div class="rw">
            @if (c.rewardType !== 'cashback') {
              <div><span class="k">Balance</span><b>{{ c.rewardBalance.toLocaleString('en-IN') }} <small>{{ reward().unit }}</small></b>
                @if (c.rewardsAsOf) { <small class="muted">as of {{ c.rewardsAsOf | date: 'd MMM' }}</small> }</div>
              <div><span class="k">Worth</span><b>{{ p.rewardsWorth !== null ? (p.rewardsWorth | money) : '—' }}</b>@if (p.rewardsWorth === null) { <small class="muted">add value per {{ unit1() }}</small> }</div>
            }
            <div><span class="k">This cycle (est.)</span><b>{{ p.rewardsThisCycle === null ? '—' : c.rewardType === 'cashback' ? (p.rewardsThisCycle | money) : p.rewardsThisCycle.toLocaleString('en-IN') + ' ' + reward().unit }}</b></div>
          </div>
        }
        @if (c.benefits.length) {
          <div class="tags">@for (b of c.benefits; track b) { <span class="tag"><app-icon [name]="bLabel(b).icon" [size]="13" />{{ bLabel(b).label }}</span> }</div>
        } @else if (c.rewardType === 'none') {
          <div class="empty-row"><app-icon name="gift" [size]="18" /><span>Track points, cashback and card perks.</span>
            <button class="btn btn-sm" (click)="edit.emit(2)"><app-icon name="plus" [size]="14" />Add</button></div>
        }
        @if (c.notes) { <p class="notes"><app-icon name="file-text" [size]="14" />{{ c.notes }}</p> }
        <p class="meta tiny muted">
          {{ c.network ? networkLabel[c.network] : 'Network not set' }}@if (c.tier) { · {{ tierLabel[c.tier] }} } · {{ exp().text }}
          @if (c.dailySpendingLimit) { · Daily limit {{ c.dailySpendingLimit | money }} }
        </p>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .co { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
    .k { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
    b { font-size: 16px; color: var(--text); font-variant-numeric: tabular-nums; }
    b small, .figs small { font-size: 12px; font-weight: 500; color: var(--text-3); }
    .meter { position: relative; display: flex; height: 12px; border-radius: 8px; background: var(--surface-2); overflow: visible; margin: 4px 0 14px; }
    .meter .billed { background: var(--c2); border-radius: 8px 0 0 8px; transition: width .5s var(--ease); }
    .meter .unbilled { background: color-mix(in srgb, var(--c2) 45%, transparent); transition: width .5s var(--ease); }
    .meter .alert-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--warn); border-radius: 2px; }
    .sw { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
    .sw.billed { background: var(--c2); } .sw.unbilled { background: color-mix(in srgb, var(--c2) 45%, transparent); }
    .figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; div { display: flex; flex-direction: column; gap: 3px; min-width: 0; } app-amount { font-weight: 700; font-size: 15px; } }
    .tip { margin: 12px 0 0; display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; line-height: 1.5; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); color: var(--text-2);
      app-icon { margin-top: 2px; flex-shrink: 0; } }
    .tip.pos { background: var(--pos-soft); color: var(--pos); } .tip.warn { background: var(--warn-soft); color: var(--warn); } .tip.neg { background: var(--neg-soft); color: var(--neg); }
    .cycle { display: flex; flex-direction: column; gap: 10px; }
    .cbar { height: 6px; border-radius: 6px; background: var(--surface-2); overflow: hidden; span { display: block; height: 100%; border-radius: 6px; background: var(--accent); transition: width .5s var(--ease); } span.done { background: var(--pos); } }
    .crow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; div { display: flex; flex-direction: column; gap: 3px; } }
    .stmt { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2);
      .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; } .due { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; } }
    .stmt[data-tone='overdue'] { border-color: var(--neg); .due { color: var(--neg); } } .stmt[data-tone='soon'] .due { color: var(--warn); } .stmt[data-tone='ok'] .due { color: var(--text-3); }
    .stmt small { color: var(--text-3); }
    .tip b { font-size: inherit; color: inherit; }
    .waiver { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; .wtop { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--text-2); b { font-size: 13px; } } }
    .rw { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; div { display: flex; flex-direction: column; gap: 3px; } }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: 12px; font-weight: 600; }
    .notes { margin: 12px 0 0; display: flex; gap: 6px; font-size: 13px; color: var(--text-2); line-height: 1.5; app-icon { margin-top: 2px; color: var(--text-3); } }
    .meta { margin: 12px 0 0; }
    .empty-row { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px dashed var(--border-strong); border-radius: 12px; color: var(--text-2); font-size: 13px;
      span { flex: 1; } app-icon { color: var(--text-3); } }
    @media (max-width: 1000px) { .co { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 520px) { .figs { grid-template-columns: repeat(2, minmax(0, 1fr)); } .crow, .rw { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class CardOverviewComponent {
  private statements = inject(CardStatementsService);
  private undo = inject(UndoService);

  readonly d = input.required<CardWithPosition>();
  /** Open the card form at this step (1 limits, 2 costs & rewards). */
  readonly edit = output<number>();

  readonly autopay = AUTOPAY_LABEL;
  readonly networkLabel = NETWORK_LABEL;
  readonly tierLabel = TIER_LABEL;
  readonly bLabel = benefitLabel;
  readonly busy = signal(false);

  readonly cyc = computed(() => billingCycle(this.d().card));
  readonly tone = computed(() => usageTone(this.d().pos.usedPct));
  readonly exp = computed(() => expiryInfo(this.d().card));
  readonly reward = computed(() => REWARD_LABEL[this.d().card.rewardType]);
  readonly hasCosts = computed(() => {
    const c = this.d().card;
    return !!(c.interestMonthly || c.annualFee || c.lateFee || c.cashAdvanceFeePct || c.forexMarkupPct);
  });

  pct(v: number): number {
    const l = this.d().pos.limit;
    return l > 0 ? Math.max(0, Math.min(100, (v / l) * 100)) : 0;
  }
  due(s: any) {
    return dueInfo(s);
  }
  ord(n: number): string {
    return `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
  }
  round(n: number): number {
    return Math.round(n * 10) / 10;
  }
  unit1(): string {
    return this.reward().unit.replace(/s$/, '');
  }

  async markPaid(): Promise<void> {
    const s = this.d().statements.find(x => x.id && x.statementDate.getTime() === this.d().pos.lastStatement?.statementDate.getTime());
    if (!s) return;
    this.busy.set(true);
    try {
      await this.statements.markPaid(s);
      this.undo.offer('Statement marked paid', () => this.statements.restorePayment(s));
    } finally {
      this.busy.set(false);
    }
  }
}
