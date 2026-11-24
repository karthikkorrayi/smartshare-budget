import { Injectable, inject } from '@angular/core';
import { Firestore, FieldPath, deleteField, doc, docData, getDoc, setDoc, updateDoc } from '@angular/fire/firestore';
import { Observable, combineLatest, distinctUntilChanged, interval, map, shareReplay, startWith, switchMap, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { FinanceService } from './finance.service';
import { SettingsService } from './settings.service';
import { Discipline, StreakKind, buildDayMap, computeDiscipline } from '../utils/discipline.util';
import { addDays, dayKey } from '../utils/spending.util';

/** Days of history loaded for streaks (current streaks longer than this keep their stored best). */
export const DISCIPLINE_DAYS = 200;
const MAX_CHECKINS = 380;

/**
 * Streaks for the Streaks page and the dashboard, from the same transactions the budget uses.
 * Also keeps "Nothing spent today" check-ins and the best streak per kind on users/{uid}.
 */
@Injectable({ providedIn: 'root' })
export class DisciplineService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private finance = inject(FinanceService);
  private settings = inject(SettingsService);
  private lastBestWrite = '';

  /** users/{uid}: check-ins and the stored best streaks. */
  private userDoc$ = this.auth
    .forUser(uid => docData(doc(this.firestore, 'users', uid)) as Observable<any>, null)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Ticks each minute so "today" rolls over at midnight while the app is open. */
  private day$ = interval(60_000).pipe(startWith(0), map(() => dayKey(new Date())), distinctUntilChanged());

  readonly state$: Observable<Discipline | null> = this.day$.pipe(
    switchMap(() => {
      const today = new Date();
      return combineLatest([
        this.finance.window$(addDays(today, -DISCIPLINE_DAYS), addDays(today, 1)),
        this.userDoc$,
        this.settings.settings$,
      ]).pipe(
        map(([txns, user, s]) => {
          const checkins = Object.keys(user?.checkins ?? {});
          const days = buildDayMap(txns.map(t => ({ date: t.date, spend: t.spend, system: t.system })), checkins);
          const since = this.auth.account()?.createdAt ?? addDays(today, -DISCIPLINE_DAYS);
          const stored = (user?.disciplineBest ?? {}) as Partial<Record<StreakKind, number>>;
          const now = new Date();
          return { d: computeDiscipline(days, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), since, s.dailyLimit, stored, now), stored };
        }),
        tap(({ d, stored }) => this.keepBest(d, stored)),
        map(({ d }) => d)
      );
    }),
    startWith(null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** "Nothing spent today" — counts as logged, so a quiet day keeps the logging streak. */
  async checkIn(day = new Date()): Promise<void> {
    const uid = this.auth.requireUid();
    const ref = doc(this.firestore, 'users', uid);
    await setDoc(ref, { uid, checkins: { [dayKey(day)]: true } }, { merge: true });
    // Keep the map small (rules allow 400): drop the oldest beyond MAX_CHECKINS.
    const keys = Object.keys((await getDoc(ref)).get('checkins') ?? {}).sort();
    if (keys.length > MAX_CHECKINS) {
      const [first, ...rest] = keys.slice(0, keys.length - MAX_CHECKINS);
      await updateDoc(ref, new FieldPath('checkins', first), deleteField(), ...rest.flatMap(k => [new FieldPath('checkins', k), deleteField()]));
    }
  }

  async undoCheckIn(day = new Date()): Promise<void> {
    const uid = this.auth.requireUid();
    await updateDoc(doc(this.firestore, 'users', uid), new FieldPath('checkins', dayKey(day)), deleteField());
  }

  /** Stores a new best streak so it survives beyond the loaded history. */
  private keepBest(d: Discipline, stored: Partial<Record<StreakKind, number>>): void {
    const better = (Object.keys(d.bests) as StreakKind[]).some(k => d.bests[k] > (stored[k] ?? 0));
    if (!better) return;
    const sig = JSON.stringify(d.bests);
    if (sig === this.lastBestWrite) return;
    this.lastBestWrite = sig;
    const uid = this.auth.user()?.uid;
    if (!uid) return;
    setDoc(doc(this.firestore, 'users', uid), { uid, disciplineBest: d.bests }, { merge: true }).catch(e => console.warn('[Discipline] best not saved', e));
  }
}
