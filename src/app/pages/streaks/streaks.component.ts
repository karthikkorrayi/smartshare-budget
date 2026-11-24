import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DisciplineService } from '../../services/discipline.service';
import { QuickActionsService } from '../../core/quick-actions.service';
import { UndoService } from '../../services/undo.service';
import { CalDay, StreakKind } from '../../utils/discipline.util';
import { IconComponent } from '../../ui/icon.component';
import { SkeletonComponent } from '../../ui/skeleton.component';
import { MoneyPipe } from '../../ui/money.pipe';
import { NotificationPrefsComponent } from '../../components/notification-prefs/notification-prefs.component';

/**
 * Streaks — financial discipline built only from what you log: logging, no-spend and
 * within-limit streaks, a 12-week calendar, badges, and the reminders that keep them going.
 */
@Component({
  standalone: true,
  imports: [RouterLink, IconComponent, SkeletonComponent, MoneyPipe, NotificationPrefsComponent],
  templateUrl: './streaks.component.html',
  styleUrl: './streaks.component.scss',
})
export class StreaksComponent {
  private discipline = inject(DisciplineService);
  private undo = inject(UndoService);
  quick = inject(QuickActionsService);

  d = toSignal(this.discipline.state$, { initialValue: null });
  busy = signal(false);

  /** Columns of 7 days (Mon→Sun) for the calendar. */
  weeks = computed(() => {
    const cal = this.d()?.calendar ?? [];
    const out: CalDay[][] = [];
    for (let i = 0; i < cal.length; i += 7) out.push(cal.slice(i, i + 7));
    return out;
  });
  monthLabels = computed(() =>
    this.weeks().map((w, i) => {
      const first = w.find(x => x.date.getDate() <= 7 && x.date.getDay() === 1) ?? (i === 0 ? w[0] : null);
      return first ? first.date.toLocaleDateString('en-IN', { month: 'short' }) : '';
    })
  );
  badgeGroups = computed(() => {
    const d = this.d();
    if (!d) return [];
    const kinds: StreakKind[] = ['logging', 'noSpend', 'withinLimit'];
    return kinds
      .map(k => ({ kind: k, title: d.streaks.find(s => s.kind === k)!.title, icon: d.streaks.find(s => s.kind === k)!.icon, badges: d.badges.filter(b => b.kind === k) }))
      .filter(g => g.badges.length);
  });
  earnedCount = computed(() => this.d()?.badges.filter(b => b.earned).length ?? 0);

  dayTitle(c: CalDay): string {
    const date = c.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    if (c.state === 'future') return date;
    if (c.state === 'before') return `${date}: before you joined`;
    const what = c.state === 'nospend' ? 'no spending' : `₹${Math.round(c.spend).toLocaleString('en-IN')} spent${c.state === 'over' ? ' (over limit)' : c.state === 'within' ? ' (within limit)' : ''}`;
    return `${date}: ${what}${c.checkin ? ' · checked in' : c.logged ? ' · logged' : ' · nothing logged'}`;
  }

  async checkIn(): Promise<void> {
    this.busy.set(true);
    try {
      await this.discipline.checkIn();
      this.undo.offer('Marked today as a no-spend day', () => this.discipline.undoCheckIn());
    } finally {
      this.busy.set(false);
    }
  }
  async undoCheckIn(): Promise<void> {
    this.busy.set(true);
    try {
      await this.discipline.undoCheckIn();
    } finally {
      this.busy.set(false);
    }
  }
}
