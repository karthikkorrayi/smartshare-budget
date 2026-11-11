import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { DEFAULT_SETTINGS, UserSettings, withDefaults } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  readonly settings$: Observable<UserSettings> = this.auth
    .forUser(uid => docData(doc(this.firestore, 'users', uid)).pipe(map(d => withDefaults((d as any)?.settings))), DEFAULT_SETTINGS)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** One-off read (used right after a spend is saved). */
  async current(): Promise<UserSettings> {
    const uid = this.auth.requireUid();
    const snap = await getDoc(doc(this.firestore, 'users', uid));
    return withDefaults(snap.get('settings'));
  }

  save(settings: UserSettings): Promise<void> {
    const uid = this.auth.requireUid();
    const clean = withDefaults(settings);
    return setDoc(doc(this.firestore, 'users', uid), { uid, settings: clean, updatedAt: serverTimestamp() }, { merge: true });
  }
}
