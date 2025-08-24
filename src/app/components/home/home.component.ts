import { Component, OnInit, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';

import { NgxEchartsDirective } from 'ngx-echarts';

import { StorageService } from '../../services/storage.service';
import { PlannerService } from '../../services/planner.service';

type Goal = any;

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    MatSidenavModule, MatButtonModule, MatCardModule, MatIconModule, MatListModule, MatDividerModule,
    NgxEchartsDirective
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  drawerOpen = signal(false);
  widgets = signal<any[]>([]);

  private platformId = inject(PLATFORM_ID);
  isBrowser = isPlatformBrowser(this.platformId);

  constructor(private store: StorageService, private planner: PlannerService, private router: Router) {}

  ngOnInit() { this.refresh(); }

  refresh() {
    const goals: Goal[] = this.store.allGoals() || [];

    const ws: any[] = goals.map(g => this.buildGoalWidget(g));

    const monthISO = this.nextMonthISO();
    const rows = this.store.getMonthExpenses(monthISO);
    if (rows.length > 0) {
      ws.push(this.buildExpensesWidget(monthISO, rows));
    }

    this.widgets.set(ws);
  }

  private nextMonthISO(fromISO?: string) {
    const base = fromISO ? new Date(fromISO + '-01') : new Date();
    const n = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildExpensesWidget(monthISO: string, rows: any[]) {
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const done = rows.filter(r => r.done).length;

    const pieOptions = {
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: '60%', data: [
        { name: 'Planned', value: total },
        { name: 'Unplanned', value: 0 },
      ]}]
    };

    return {
      kind: 'expenses',
      id: `expenses-${monthISO}`,
      title: `🧾 Expenses — ${monthISO}`,
      subtitle: done ? `${done}/${rows.length} marked done` : `${rows.length} items`,
      actions: [
        { label: 'Open', route: ['/expenses'] },
        { label: 'Next →', click: () => { this.store.copyToNextMonth(monthISO); this.router.navigate(['/expenses']); } }
      ],
      pieOptions
    };
  }

  private buildGoalWidget(g: any) {
    const base = this.planner.baseline(g.incomeMin, !!g.baselineSavingsOn);
    const expTotal = this.planner.sumExpenses(g.expenses || []);

    let monthly = 0;
    let titleIcon = '🎯';
    let label = 'Contribution';

    if (g.type === 'loan') {
      titleIcon = '🏦'; label = 'EMI';
      monthly = this.planner.emi(g.principal, g.apr, g.tenure);
    } else if (g.type === 'trip') {
      titleIcon = '✈';
      const months = this.planner.monthsUntil(g.tripMonth);
      monthly = Math.ceil(g.price / months);
    } else if (g.type === 'savings') {
      titleIcon = '💰';
      monthly = g.chosen?.monthly ?? Math.ceil(g.price / (g.desiredMonths || 6));
    } else {
      titleIcon = '🛍️';
      monthly = g.chosen?.monthly ?? 0;
    }

    const pieOptions = {
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: '60%', data: [
        { name: 'Existing Payments', value: expTotal },
        { name: 'Baseline Savings', value: base },
        { name: label, value: monthly }
      ]}]
    };

    const openRoute =
      g.type === 'loan' ? ['/loan', g.id] :
      g.type === 'trip' ? ['/trip', g.id] :
      g.type === 'savings' ? ['/savings', g.id] :
      ['/target', g.id];

    const editRoute =
      g.type === 'loan' ? ['/loan', g.id, 'edit'] :
      g.type === 'trip' ? ['/trip', g.id, 'edit'] :
      g.type === 'savings' ? ['/savings', g.id, 'edit'] :
      ['/target', g.id, 'edit'];

    return {
      kind: g.type,
      id: g.id,
      title: `${titleIcon} ${g.title}`,
      subtitle: this.buildSubtitle(g, monthly),
      actions: [
        { label: 'Open', route: openRoute },
        { label: 'Edit', route: editRoute }
      ],
      pieOptions
    };
  }

  private buildSubtitle(g: any, monthly: number) {
    if (g.type === 'loan') return `₹${g.principal} @ ${g.apr}% • ${g.tenure} mo • EMI ₹${monthly}`;
    if (g.type === 'trip') return `₹${g.price} by ${g.tripMonth} • Save ₹${monthly}/mo`;
    if (g.type === 'savings') return `Target ₹${g.price} • Save ₹${monthly}/mo • ~${g.monthsRequired || g.desiredMonths} mo`;
    return `Target ₹${g.price} • Contribute ₹${monthly}/mo • ~${g.monthsRequired} mo`;
  }

  openDrawer() { this.drawerOpen.set(true); }
  closeDrawer() { this.drawerOpen.set(false); }

  add(type: 'target' | 'loan' | 'trip' | 'savings' | 'expenses') {
    this.closeDrawer();
    if (type === 'target') this.router.navigate(['/target', 'new']);
    else if (type === 'loan') this.router.navigate(['/loan', 'new']);
    else if (type === 'trip') this.router.navigate(['/trip', 'new']);
    else if (type === 'savings') this.router.navigate(['/savings', 'new']);
    else this.router.navigate(['/expenses']);
  }

  onAction(a: { label: string; route?: any[]; click?: () => void }) {
    if (a?.route) this.router.navigate(a.route);
    else if (a?.click) a.click();
  }
}
