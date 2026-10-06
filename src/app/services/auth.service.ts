import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { Firestore, addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from '@angular/fire/firestore';
import { AvatarService } from './avatar.service';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  avatarUrl: string;
  avatarStyle: string;
  googleUid: string;
  isRegistered: boolean;
  pin?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private zone = inject(NgZone);
  private avatars = inject(AvatarService);
  private unlockKey = 'smartshare_pin_unlocked';
  private emailPassword = 'SmartShareBudget#2026!';
  private profileWriteVersion = 0;

  user = signal<User | null>(null);
  profile = signal<UserProfile | null>(null);
  loading = signal(true);
  pinUnlocked = signal(sessionStorage.getItem(this.unlockKey) === 'true');
  isRegistered = computed(() => this.profile()?.isRegistered === true);

  private readyResolve!: () => void;
  readonly ready = new Promise<void>(resolve => (this.readyResolve = resolve));

  constructor() {
    onAuthStateChanged(this.auth, user => {
      void this.zone.run(async () => {
        this.loading.set(true);
        this.user.set(user);

        if (user) {
          const loadVersion = this.profileWriteVersion;
          const profile = await this.loadOrCreateProfile(user);
          if (loadVersion === this.profileWriteVersion) {
            this.profile.set(profile);
            this.pinUnlocked.set(sessionStorage.getItem(this.unlockKey) === 'true');
          }
        } else {
          this.profile.set(null);
          this.setPinUnlocked(false);
        }

        this.loading.set(false);
        this.readyResolve();
      });
    });
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(this.auth, provider);
    await this.finishSignIn(credential.user);
  }

  async continueWithEmail(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Email is required.');

    let user: User;
    try {
      user = (await signInWithEmailAndPassword(this.auth, normalizedEmail, this.emailPassword)).user;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
      if (code !== 'auth/user-not-found' && code !== 'auth/invalid-credential') throw error;
      user = (await createUserWithEmailAndPassword(this.auth, normalizedEmail, this.emailPassword)).user;
      await updateProfile(user, { displayName: normalizedEmail.split('@')[0] });
    }

    await this.finishSignIn(user);
  }

  async completePinSetup(pin: string, avatarUrl?: string, avatarStyle?: string): Promise<void> {
    const user = this.requireUser();
    const profile = this.profile();
    const selectedAvatarUrl = avatarUrl || profile?.avatarUrl || this.avatars.defaultAvatar(user.uid);
    const ref = doc(this.firestore, 'users', user.uid);
    this.profileWriteVersion += 1;
    await setDoc(ref, {
      pin,
      avatarUrl: selectedAvatarUrl,
      avatarStyle: avatarStyle || profile?.avatarStyle || 'bottts',
      isRegistered: true,
      lastLogin: serverTimestamp(),
      verificationEmailSent: false,
    }, { merge: true });
    this.profile.set({
      ...profile!,
      uid: user.uid,
      displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'SmartShare User',
      email: profile?.email || (user.email ?? '').toLowerCase(),
      photoURL: '',
      googleUid: user.uid,
      pin,
      avatarUrl: selectedAvatarUrl,
      avatarStyle: avatarStyle || profile?.avatarStyle || 'bottts',
      isRegistered: true,
    });
    this.setPinUnlocked(true);
  }

  async verifyPin(pin: string): Promise<boolean> {
    const user = this.requireUser();
    const snap = await getDoc(doc(this.firestore, 'users', user.uid));
    const ok = snap.exists() && snap.data()['pin'] === pin;
    if (ok) this.setPinUnlocked(true);
    return ok;
  }

  async requestPinReset(email: string): Promise<void> {
    const users = await getDocs(query(collection(this.firestore, 'users'), where('email', '==', email.trim().toLowerCase())));
    if (users.empty) return;
    const profile = users.docs[0].data();
    const token = crypto.randomUUID();
    await addDoc(collection(this.firestore, 'pinResetTokens'), {
      token,
      email: profile['email'],
      uid: profile['uid'] ?? profile['googleUid'],
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      used: false,
    });
    console.info(`PIN reset link: ${location.origin}${location.pathname}#/reset-pin/${token}`);
  }

  async resetPin(token: string, pin: string): Promise<boolean> {
    const tokens = await getDocs(query(collection(this.firestore, 'pinResetTokens'), where('token', '==', token), where('used', '==', false)));
    if (tokens.empty) return false;
    const tokenDoc = tokens.docs[0];
    const data = tokenDoc.data();
    const expiresAt = data['expiresAt']?.toDate ? data['expiresAt'].toDate() : new Date(data['expiresAt']);
    if (expiresAt < new Date()) return false;
    await updateDoc(doc(this.firestore, 'users', data['uid'] ?? data['googleUid']), { pin, lastLogin: serverTimestamp() });
    await updateDoc(tokenDoc.ref, { used: true });
    return true;
  }

  async logout(): Promise<void> {
    this.setPinUnlocked(false);
    await signOut(this.auth);
    await this.router.navigateByUrl('/login');
  }

  setPinUnlocked(unlocked: boolean): void {
    this.pinUnlocked.set(unlocked);
    if (unlocked) sessionStorage.setItem(this.unlockKey, 'true');
    else sessionStorage.removeItem(this.unlockKey);
  }

  private async finishSignIn(user: User): Promise<void> {
    const loadVersion = this.profileWriteVersion;
    const profile = await this.loadOrCreateProfile(user);
    this.zone.run(() => {
      this.user.set(user);
      if (loadVersion === this.profileWriteVersion) {
        this.profile.set(profile);
      }
      this.setPinUnlocked(false);
    });
    await this.router.navigateByUrl(profile.isRegistered ? '/unlock' : '/setup-pin');
  }

  private async loadOrCreateProfile(user: User): Promise<UserProfile> {
    const ref = doc(this.firestore, 'users', user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : undefined;
    const fallbackAvatar = this.avatars.defaultAvatar(user.uid);
    const base = {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'SmartShare User',
      email: (user.email ?? '').toLowerCase(),
      photoURL: '',
      avatarUrl: data?.['avatarUrl'] || fallbackAvatar,
      avatarStyle: data?.['avatarStyle'] || 'bottts',
      googleUid: user.uid,
      lastLogin: serverTimestamp(),
    };
    if (!snap.exists()) {
      await setDoc(ref, { ...base, createdAt: serverTimestamp(), isRegistered: false, verificationEmailSent: false });
      return { ...base, isRegistered: false };
    }
    await updateDoc(ref, { ...base });
    return { ...base, isRegistered: data?.['isRegistered'] === true, pin: data?.['pin'] };
  }

  private requireUser(): User {
    const user = this.user();
    if (!user) throw new Error('Authentication is required.');
    return user;
  }
}