import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { NotificationsService } from '../../services/notifications.service';
import { ReviewService } from '../../services/review.service';
import { AppNotification, NOTIFICATION_ICONS, Reminder } from '../../models/app-notification.model';
import { ReviewItem } from '../../models/review-item.model';

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

  readonly icons = NOTIFICATION_ICONS;

  private rawStored = toSignal(this.notifications.stored$);
  reminders = toSignal(this.notifications.reminders$, { initialValue: [] as Reminder[] });
  pending = toSignal(this.review.pending$, { initialValue: [] as ReviewItem[] });

  loading = computed(() => this.rawStored() === undefined);
  filter = signal<Filter>('all');
  actionError = signal('');

  stored = computed(() => this.rawStored() ?? []);
  unreadCount = computed(() => this.stored().filter(n => !n.read).length);
  shown = computed(() => (this.filter() === 'unread' ? this.stored().filter(n => !n.read) : this.stored()));
  hasRead = computed(() => this.stored().some(n => n.read));

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
    this.safe(() => this.notifications.clearRead(this.stored()));
  }

  remove(n: AppNotification): void {
    this.safe(() => this.notifications.delete(n.id));
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
