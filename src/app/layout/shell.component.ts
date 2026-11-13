import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DatePipe } from '@angular/common';
import { combineLatest, filter, map, startWith } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotificationsService } from '../services/notifications.service';
import { ReviewService } from '../services/review.service';
import { ThemePref, ThemeService } from '../core/theme.service';
import { InstallService } from '../core/install.service';
import { QuickActionsService } from '../core/quick-actions.service';
import { IconComponent } from '../ui/icon.component';
import { LogoComponent } from './logo.component';
import { NOTIFICATION_ICONS } from '../models/app-notification.model';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
  badge?: () => number;
}

const COLLAPSE_KEY = 'ssb_sidebar_collapsed';

/**
 * Signed-in application shell: collapsible sidebar (desktop), top bar with quick actions, theme,
 * notifications and profile menus, and a bottom navigation + quick-add button on phones.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, IconComponent, LogoComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  auth = inject(AuthService);
  theme = inject(ThemeService);
  install = inject(InstallService);
  private quick = inject(QuickActionsService);
  private notifications = inject(NotificationsService);
  private review = inject(ReviewService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly today = new Date();
  readonly icons = NOTIFICATION_ICONS;

  collapsed = signal(readCollapsed());
  drawerOpen = signal(false);
  menu = signal<'profile' | 'bell' | 'add' | null>(null);
  online = signal(navigator.onLine);

  badge = toSignal(this.notifications.badgeCount$, { initialValue: 0 });
  pending = toSignal(this.review.pending$.pipe(map(p => p.length)), { initialValue: 0 });

  /** Bell panel: newest reminders + unread activity (max 8). */
  feed = toSignal(
    combineLatest([this.notifications.reminders$, this.notifications.stored$, this.notifications.seenReminderKeys$]).pipe(
      map(([rem, stored, seen]) => [
        ...rem.map(r => ({ key: r.key, icon: NOTIFICATION_ICONS[r.type] ?? 'bell', title: r.title, body: r.body, link: r.link, tone: r.tone, unread: !seen.has(r.key), date: r.date as Date | null })),
        ...stored.slice(0, 20).map(n => ({ key: n.id, icon: NOTIFICATION_ICONS[n.type] ?? 'bell', title: n.title, body: n.body, link: n.link ?? '/notifications', tone: 'info' as const, unread: !n.read, date: n.createdAt })),
      ].slice(0, 8))
    ),
    { initialValue: [] }
  );

  readonly primary: NavItem[] = [
    { path: '/', label: 'Dashboard', icon: 'layout-dashboard', exact: true },
    { path: '/recurring', label: 'Recurring', icon: 'repeat' },
    { path: '/review', label: 'Review', icon: 'clipboard-list', badge: () => this.pending() },
  ];
  readonly manage: NavItem[] = [
    { path: '/cards', label: 'Credit cards', icon: 'credit-card', exact: true },
    { path: '/cards/wallets', label: 'Wallets', icon: 'wallet' },
    { path: '/cards/statements', label: 'Card statements', icon: 'receipt-text' },
    { path: '/cards/transactions', label: 'Card transactions', icon: 'list-checks' },
  ];
  readonly connect: NavItem[] = [
    { path: '/gmail', label: 'Gmail sync', icon: 'mail' },
    { path: '/notifications', label: 'Notifications', icon: 'bell', badge: () => this.badge() },
    { path: '/profile', label: 'Settings', icon: 'settings' },
  ];

  /** Page title / subtitle from the active route's data. */
  private routeData = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        let r = this.route.snapshot;
        let data: any = {};
        while (r) {
          data = { ...data, ...r.data };
          r = r.firstChild!;
        }
        return data as { title?: string; subtitle?: string };
      })
    ),
    { initialValue: {} as { title?: string; subtitle?: string } }
  );
  title = computed(() => this.routeData().title ?? 'SmartShare Budget');

  firstName = computed(() => {
    const a = this.auth.account();
    return a?.displayName?.trim().split(/\s+/)[0] || a?.email?.split('@')[0] || '';
  });
  initial = computed(() => (this.auth.account()?.displayName || this.auth.account()?.email || '?').charAt(0).toUpperCase());

  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.drawerOpen.set(false);
      this.menu.set(null);
    });
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  toggleCollapsed(): void {
    this.collapsed.update(v => !v);
    try { localStorage.setItem(COLLAPSE_KEY, this.collapsed() ? '1' : '0'); } catch { /* ignore */ }
  }

  toggle(which: 'profile' | 'bell' | 'add', e: Event): void {
    e.stopPropagation();
    this.menu.update(m => (m === which ? null : which));
  }

  setTheme(p: ThemePref): void {
    this.theme.set(p);
  }

  add(mode: 'expense' | 'income' | 'transfer'): void {
    this.menu.set(null);
    this.quick.addTxn(mode);
  }

  open(link: string | null): void {
    this.menu.set(null);
    // "N new items to review" notifications point at the email inbox inside Review.
    if (link) this.router.navigateByUrl(link === '/review' ? '/review/inbox' : link);
  }

  async installApp(): Promise<void> {
    this.menu.set(null);
    await this.install.install();
  }

  logout(): void {
    this.menu.set(null);
    this.auth.logout();
  }

  @HostListener('document:click')
  closeMenus(): void {
    if (this.menu()) this.menu.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menu.set(null);
    this.drawerOpen.set(false);
  }
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
