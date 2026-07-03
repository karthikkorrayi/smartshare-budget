import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, GoogleAuthProvider, User, onAuthStateChanged, signInWithPopup, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from '@angular/fire/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  googleUid: string;
  isRegistered: boolean;
  pin?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private unlockKey = 'smartshare_pin_unlocked';

  user = signal<User | null>(null);
  profile = signal<UserProfile | null>(null);
  loading = signal(true);
  pinUnlocked = signal(sessionStorage.getItem(this.unlockKey) === 'true');
  isRegistered = computed(() => this.profile()?.isRegistered === true);

  constructor() {
    onAuthStateChanged(this.auth, async user => {
      this.loading.set(true);
      this.user.set(user);
      this.pinUnlocked.set(false);
      sessionStorage.removeItem(this.unlockKey);

      if (user) {
        const profile = await this.loadOrCreateProfile(user);
        this.profile.set(profile);
      } else {
        this.profile.set(null);
      }

      this.loading.set(false);
    });
  }

  async signInWithGoogle(): Promise<void> {
    const credential = await signInWithPopup(this.auth, new GoogleAuthProvider());
    const profile = await this.loadOrCreateProfile(credential.user);
    this.profile.set(profile);
    await this.router.navigateByUrl(profile.isRegistered ? '/unlock' : '/setup-pin');
  }

  async completePinSetup(pin: string): Promise<void> {
    const user = this.requireUser();
    const ref = doc(this.firestore, 'users', user.uid);
    await updateDoc(ref, {
      pin,
      isRegistered: true,
      lastLogin: serverTimestamp(),
      verificationEmailSent: false
    });
    this.profile.set({ ...this.profile()!, pin, isRegistered: true });
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
      googleUid: profile['googleUid'],
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      used: false
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
    await updateDoc(doc(this.firestore, 'users', data['googleUid']), { pin, lastLogin: serverTimestamp() });
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

  private async loadOrCreateProfile(user: User): Promise<UserProfile> {
    const ref = doc(this.firestore, 'users', user.uid);
    const snap = await getDoc(ref);
    const base = {
      uid: user.uid,
      displayName: user.displayName ?? '',
      email: (user.email ?? '').toLowerCase(),
      photoURL: user.photoURL ?? '',
      googleUid: user.uid,
      lastLogin: serverTimestamp()
    };
    if (!snap.exists()) {
      await setDoc(ref, { ...base, createdAt: serverTimestamp(), isRegistered: false, verificationEmailSent: false });
      return { ...base, isRegistered: false };
    }
    await updateDoc(ref, { ...base });
    const data = snap.data();
    return { ...base, isRegistered: data['isRegistered'] === true, pin: data['pin'] };
  }

  private requireUser(): User {
    const user = this.user();
    if (!user) throw new Error('Authentication is required.');
    return user;
  }
}