import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { NotificationsService } from '../../services/notifications.service';
import { ReviewService } from '../../services/review.service';
import { AppNotification, NOTIFICATION_ICONS, Reminder } from '../../models/app-notification.model';
import { ReviewItem } from '../../models/review-item.model';
import { UndoService } from '../../services/undo.service';

type Filter = 'all' | 'unread';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent {
  private notifications = inject(NotificationsService);
  private review = inject(ReviewService);
  private router = inject(Router);
  private undo = inject(UndoService);
  private destroyRef = inject(DestroyRef);

  readonly icons = NOTIFICATION_ICONS;

  private rawStored = toSignal(this.notifications.stored$);
  reminders = toSignal(this.notifications.reminders$, { initialValue: [] as Reminder[] });
  pending = toSignal(this.review.pending$, { initialValue: [] as ReviewItem[] });

  loading = computed(() => this.rawStored() === undefined);
  filter = signal<Filter>('all');
  actionError = signal('');

  /** Notifications held for Undo are hidden immediately. */
  stored = computed(() => (this.rawStored() ?? []).filter(n => !this.undo.hidden().has(n.id)));
  unreadCount = computed(() => this.stored().filter(n => !n.read).length);
  /** "Unread" keeps showing what was new when you arrived, for the rest of this visit. */
  shown = computed(() => (this.filter() === 'unread' ? this.stored().filter(n => !n.read || this.newThisVisit().has(n.id)) : this.stored()));
  newCount = computed(() => this.stored().filter(n => !n.read || this.newThisVisit().has(n.id)).length);
  hasRead = computed(() => this.stored().some(n => n.read));

  /** undefined until the seen list has loaded — avoids flashing every reminder as new. */
  private seen = toSignal(this.notifications.seenReminderKeys$);
  /**
   * What was new when you opened this page. It stays highlighted for this visit only, while
   * everything is recorded as seen/read — so leaving and coming back doesn't show it as new again.
   */
  newThisVisit = signal<Set<string>>(new Set());
  private viewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const seen = this.seen();
      if (this.loading() || !seen) return;
      const stored = this.stored();
      const reminders = this.reminders();
      untracked(() => {
        const fresh = new Set([...stored.filter(n => !n.read).map(n => n.id), ...reminders.filter(r => !seen.has(r.key)).map(r => r.key)]);
        if (!fresh.size) return;
        this.newThisVisit.update(prev => new Set([...prev, ...fresh]));
        // Give the page a moment on screen, then record it as viewed (also covers items that arrive while it's open).
        if (this.viewTimer) clearTimeout(this.viewTimer);
        this.viewTimer = setTimeout(() => this.recordViewed(), 1500);
      });
    });
    // Leaving quickly still counts as having seen the page.
    this.destroyRef.onDestroy(() => {
      if (this.viewTimer) {
        clearTimeout(this.viewTimer);
        this.recordViewed();
      }
    });
  }

  isNew(id: string): boolean {
    return this.newThisVisit().has(id);
  }

  private recordViewed(): void {
    this.viewTimer = null;
    this.notifications.markViewed(this.reminders(), this.stored()).catch(err => console.warn('[Notifications] mark viewed failed', err));
  }

  async open(n: AppNotification): Promise<void> {
    await this.safe(() => this.notifications.markRead(n));
    if (n.link) this.router.navigateByUrl(n.link);
  }

  markRead(n: AppNotification): void {
    this.safe(() => this.notifications.markRead(n));
  }

  markAllRead(): void {
    this.safe(() => this.notifications.markAllRead(this.stored()));
  }

  clearRead(): void {
    const read = this.stored().filter(n => n.read);
    if (!read.length) return;
    this.undo.defer(`Cleared ${read.length} read notification${read.length === 1 ? '' : 's'}`, read.map(n => n.id), () =>
      this.notifications.clearRead(read)
    );
  }

  remove(n: AppNotification): void {
    this.undo.defer('Notification deleted', [n.id], () => this.notifications.delete(n.id));
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    this.actionError.set('');
    try {
      await fn();
    } catch (err) {
      console.error('[Notifications]', err);
      this.actionError.set('That action failed. Check your connection and try again.');
    }
  }
}
