import { Injectable, NgZone, inject } from '@angular/core';
import { Auth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, query, where, collection, getDocs } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Observable } from 'rxjs';
import * as CryptoJS from 'crypto-js';

interface UserProfile {
  email: string;
  googleUid: string;
  displayName: string;
  pin: string | null;
  photoURL: string;
  isRegistered: boolean;
  createdAt: Date;
  lastLogin: Date;
  verificationEmailSent: boolean;
}

interface PinResetToken {
  googleUid: string;
  token: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUser$ = new BehaviorSubject<User | null>(null);
  private isAuthenticated$ = new BehaviorSubject<boolean>(false);
  private userProfile$ = new BehaviorSubject<UserProfile | null>(null);
  private SECRET_KEY = 'smartshare-budget-secret-2025';

  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private ngZone = inject(NgZone);

  constructor() {
    this.initializeAuthState();
  }

  private initializeAuthState() {
    onAuthStateChanged(this.auth, (user) => {
      this.ngZone.run(() => {
        this.currentUser$.next(user);
        this.isAuthenticated$.next(!!user);
        if (user) {
          this.loadUserProfile(user.uid);
        } else {
          this.userProfile$.next(null);
        }
      });
    });
  }

  // Google Sign-In
  async signInWithGoogle(): Promise<{ isNewUser: boolean; user: Partial<UserProfile> }> {
    return this.ngZone.run(async () => {
      try {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(this.auth, provider);
        const user = result.user;

        console.log('Google Sign-In successful:', user.email);

        // Check if user exists in Firestore
        const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));

        if (userDoc.exists()) {
          console.log('Existing user found:', userDoc.data());
          return { isNewUser: false, user: userDoc.data() as Partial<UserProfile> };
        } else {
          console.log('New user detected, creating profile');
          await this.createNewUser(user);
          return { 
            isNewUser: true, 
            user: { 
              email: user.email || '', 
              googleUid: user.uid 
            } 
          };
        }
      } catch (error) {
        console.error('Google Sign-In Error:', error);
        throw error;
      }
    });
  }

  // Create new user in Firestore
  private async createNewUser(firebaseUser: User): Promise<void> {
    const userData: UserProfile = {
      email: firebaseUser.email || '',
      googleUid: firebaseUser.uid,
      photoURL: firebaseUser.photoURL || '',
      displayName: firebaseUser.displayName || '',
      isRegistered: false,
      pin: null,
      createdAt: new Date(),
      lastLogin: new Date(),
      verificationEmailSent: false
    };

    console.log('Creating new user document:', userData);
    await setDoc(doc(this.firestore, 'users', firebaseUser.uid), userData);
  }

  // Complete registration (set PIN and name)
  async completeRegistration(googleUid: string, displayName: string, pin: string): Promise<void> {
    return this.ngZone.run(async () => {
      try {
        const encryptedPin = this.encryptPin(pin);
        
        console.log('Updating user registration:', { googleUid, displayName, pinEncrypted: encryptedPin });

        await setDoc(
          doc(this.firestore, 'users', googleUid),
          {
            displayName,
            pin: encryptedPin,
            isRegistered: true,
            lastLogin: new Date()
          },
          { merge: true }
        );

        console.log('Registration completed successfully');

        // Reload user profile
        await this.loadUserProfile(googleUid);
      } catch (error) {
        console.error('Registration error:', error);
        throw error;
      }
    });
  }

  // Verify PIN for registered user
  async verifyPin(googleUid: string, pin: string): Promise<boolean> {
    return this.ngZone.run(async () => {
      try {
        console.log('Verifying PIN for user:', googleUid);

        const userDoc = await getDoc(doc(this.firestore, 'users', googleUid));
        
        if (!userDoc.exists()) {
          console.error('User document not found');
          return false;
        }

        const userData = userDoc.data() as UserProfile;
        console.log('User data:', { email: userData.email, isRegistered: userData.isRegistered });

        if (!userData.isRegistered) {
          console.error('User is not registered');
          return false;
        }

        const storedPin = userData.pin;
        const inputPin = this.encryptPin(pin);

        console.log('PIN comparison:', { match: storedPin === inputPin });

        return storedPin === inputPin;
      } catch (error) {
        console.error('PIN verification error:', error);
        return false;
      }
    });
  }

  // Reset PIN - send email with token via Cloud Function
  async initiatePasswordReset(email: string): Promise<void> {
    return this.ngZone.run(async () => {
      try {
        console.log('Initiating password reset for email:', email);

        const usersRef = collection(this.firestore, 'users');
        const q = query(usersRef, where('email', '==', email.toLowerCase()));
        const querySnapshot = await getDocs(q);

        console.log('Query result:', querySnapshot.docs.length, 'users found');

        if (querySnapshot.empty) {
          console.error('No user found with email:', email);
          throw new Error('User not found with this email');
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data() as UserProfile;
        const googleUid = userDoc.id;
        const token = this.generateSecureToken();

        // Store reset token
        const tokenData: PinResetToken = {
          googleUid,
          token,
          email: email.toLowerCase(),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          used: false
        };

        console.log('Storing reset token:', token);
        await setDoc(doc(this.firestore, 'pinResetTokens', token), tokenData);

        // Try to call Cloud Function to send email
        try {
          const sendResetEmail = httpsCallable(this.functions, 'sendPinResetEmail');
          await sendResetEmail({
            email: email.toLowerCase(),
            token,
            displayName: userData.displayName
          });
          console.log('Reset email sent successfully via Cloud Function');
        } catch (functionError: any) {
          // Cloud Function not available (development mode or not deployed)
          console.warn('Cloud Function not available:', functionError.message);
          console.log('Reset token created locally. In production, deploy Cloud Function to send email.');
          console.log('Reset link for testing: https://yourdomain.com/reset-pin?token=' + token);
        }
      } catch (error) {
        console.error('Password reset error:', error);
        throw error;
      }
    });
  }

  // Verify reset token and update PIN
  async resetPin(token: string, newPin: string): Promise<boolean> {
    return this.ngZone.run(async () => {
      try {
        const tokenDoc = await getDoc(doc(this.firestore, 'pinResetTokens', token));

        if (!tokenDoc.exists()) {
          throw new Error('Invalid or expired token');
        }

        const tokenData = tokenDoc.data() as PinResetToken;

        // Check if token is expired
        const expiresAt = new Date(tokenData.expiresAt);
        if (expiresAt < new Date()) {
          throw new Error('Token has expired');
        }

        if (tokenData.used) {
          throw new Error('Token already used');
        }

        // Update PIN
        const encryptedPin = this.encryptPin(newPin);
        await setDoc(
          doc(this.firestore, 'users', tokenData.googleUid),
          { pin: encryptedPin },
          { merge: true }
        );

        // Mark token as used
        await setDoc(
          doc(this.firestore, 'pinResetTokens', token),
          { used: true },
          { merge: true }
        );

        return true;
      } catch (error) {
        console.error('PIN reset error:', error);
        throw error;
      }
    });
  }

  // Helper: Encrypt PIN using SHA256
  private encryptPin(pin: string): string {
    return CryptoJS.SHA256(pin + this.SECRET_KEY).toString();
  }

  // Helper: Generate secure token
  private generateSecureToken(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Date.now().toString(36);
  }

  // Load user profile
  private async loadUserProfile(uid: string): Promise<void> {
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() as UserProfile;
        console.log('User profile loaded:', { email: userData.email, isRegistered: userData.isRegistered });
        this.ngZone.run(() => {
          this.userProfile$.next(userData);
        });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }

  // Sign out
  async signOut(): Promise<void> {
    return this.ngZone.run(async () => {
      try {
        await signOut(this.auth);
        this.currentUser$.next(null);
        this.isAuthenticated$.next(false);
        this.userProfile$.next(null);
        console.log('User signed out successfully');
      } catch (error) {
        console.error('Sign out error:', error);
        throw error;
      }
    });
  }

  // Observables
  getCurrentUser(): Observable<User | null> {
    return this.currentUser$.asObservable();
  }

  getIsAuthenticated(): Observable<boolean> {
    return this.isAuthenticated$.asObservable();
  }

  getUserProfile(): Observable<UserProfile | null> {
    return this.userProfile$.asObservable();
  }

  // Get current user synchronously (for immediate checks)
  getCurrentUserSync(): User | null {
    return this.currentUser$.getValue();
  }

  // Get current user profile synchronously
  getUserProfileSync(): UserProfile | null {
    return this.userProfile$.getValue();
  }

  // Get current user ID
  getCurrentUserId(): string | null {
    return this.currentUser$.getValue()?.uid || null;
  }
}
