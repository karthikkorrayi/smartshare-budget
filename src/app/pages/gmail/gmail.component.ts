import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { GmailService, gmailMessage } from '../../services/gmail.service';
import { ReviewService } from '../../services/review.service';
import { GmailConnection, MONITOR_GROUPS, MONITOR_GROUP_INFO, MonitorGroup } from '../../models/gmail.model';
import { AuthService } from '../../services/auth.service';
import { NotificationsService } from '../../services/notifications.service';
import { UndoService } from '../../services/undo.service';
import { IconComponent } from '../../ui/icon.component';

@Component({
  selector: 'app-gmail',
  standalone: true,
  imports: [IconComponent, DatePipe, RouterLink],
  templateUrl: './gmail.component.html',
  styleUrl: './gmail.component.scss',
})
export class GmailComponent {
  private gmail = inject(GmailService);
  private undo = inject(UndoService);
  private readonly _visit = inject(NotificationsService).markReadOnVisit('/gmail');
  private review = inject(ReviewService);
  private auth = inject(AuthService);

  readonly groups = MONITOR_GROUPS;
  readonly groupInfo = MONITOR_GROUP_INFO;
  readonly configured = this.gmail.configured;
  readonly secretInClientId = this.gmail.misconfiguredWithSecret;

  private raw = toSignal(this.gmail.connections$);
  connections = computed(() => this.raw() ?? []);
  loading = computed(() => this.raw() === undefined);
  pendingCount = toSignal(this.review.pending$, { initialValue: [] });

  // Connect form
  showConnect = signal(false);
  backfillDays = signal(30);
  chosenGroups = signal<MonitorGroup[]>([...MONITOR_GROUPS]);
  connecting = signal(false);

  busyId = signal<string | null>(null);
  confirmDisconnectId = signal<string | null>(null);
  notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  suggestOwnGmail = computed(() => {
    const me = this.auth.account()?.email;
    return me && !this.connections().some(c => c.email === me) ? me : null;
  });

  toggleChosen(g: MonitorGroup): void {
    this.chosenGroups.update(list => (list.includes(g) ? list.filter(x => x !== g) : [...list, g]));
  }

  async connect(loginHint?: string): Promise<void> {
    if (!this.chosenGroups().length) {
      this.notice.set({ kind: 'error', text: 'Choose at least one category to monitor.' });
      return;
    }
    this.connecting.set(true);
    this.notice.set(null);
    try {
      const res = await this.gmail.connect(this.backfillDays(), this.chosenGroups(), loginHint);
      const s = res.stats;
      this.showConnect.set(false);
      this.notice.set({
        kind: 'ok',
        text: `Connected ${res.email}. ${s ? `Scanned ${s.scanned} email${s.scanned === 1 ? '' : 's'}, ${s.created} sent to Review.` : ''}${s && !s.complete ? ' Older emails continue in the background.' : ''}`,
      });
    } catch (e) {
      this.notice.set({ kind: 'error', text: gmailMessage(e) });
    } finally {
      this.connecting.set(false);
    }
  }

  async syncNow(c: GmailConnection): Promise<void> {
    await this.act(c.id, async () => {
      const s = await this.gmail.syncNow(c.id);
      return `${c.email}: scanned ${s.scanned}, ${s.created} new for review${s.duplicates ? `, ${s.duplicates} already seen` : ''}.`;
    });
  }

  async togglePaused(c: GmailConnection): Promise<void> {
    await this.act(c.id, async () => {
      await this.gmail.setPaused(c, !c.paused);
      this.undo.offer(c.paused ? `Monitoring resumed for ${c.email}` : `Monitoring paused for ${c.email}`, () =>
        this.gmail.setPaused(c, c.paused)
      );
      return ''; // the Undo bar confirms it
    });
  }

  async toggleGroup(c: GmailConnection, g: MonitorGroup): Promise<void> {
    const next = c.groups.includes(g) ? c.groups.filter(x => x !== g) : [...c.groups, g];
    if (!next.length) {
      this.notice.set({ kind: 'error', text: 'Keep at least one category, or pause monitoring instead.' });
      return;
    }
    await this.act(c.id, async () => {
      await this.gmail.setGroups(c, next);
      return '';
    });
  }

  async reconnect(c: GmailConnection): Promise<void> {
    this.chosenGroups.set(c.groups);
    this.backfillDays.set(7);
    await this.connect(c.email);
  }

  async disconnect(c: GmailConnection): Promise<void> {
    await this.act(c.id, async () => {
      await this.gmail.disconnect(c.id);
      this.confirmDisconnectId.set(null);
      return `${c.email} disconnected and access revoked. Items already in Review were kept.`;
    });
  }

  statusTone(c: GmailConnection): string {
    if (c.paused) return 'tone-closed';
    return c.status === 'active' ? 'tone-ok' : c.status === 'reauth_required' ? 'tone-soon' : 'tone-overdue';
  }

  statusText(c: GmailConnection): string {
    if (c.paused) return 'Paused';
    return c.status === 'active' ? (c.backfillInProgress ? 'Scanning history…' : 'Monitoring') : c.status === 'reauth_required' ? 'Reconnect needed' : 'Error';
  }

  private async act(id: string, fn: () => Promise<string>): Promise<void> {
    this.busyId.set(id);
    this.notice.set(null);
    try {
      const text = await fn();
      if (text) this.notice.set({ kind: 'ok', text });
    } catch (e) {
      this.notice.set({ kind: 'error', text: gmailMessage(e) });
    } finally {
      this.busyId.set(null);
    }
  }
}
