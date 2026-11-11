export const environment = {
  firebase: {
    apiKey: "AIzaSyBNGnXXho0kHwmEUTFJKtM5rMeNzLckWB8",
    authDomain: "mybudgetapp-54c43.firebaseapp.com",
    projectId: "mybudgetapp-54c43",
    storageBucket: "mybudgetapp-54c43.firebasestorage.app",
    messagingSenderId: "231457872788",
    appId: "1:231457872788:web:4fabec01905c59479a0d81"
  },
  /** Region of the Gmail Cloud Functions (must match functions/src/config.ts). */
  functionsRegion: 'asia-south1',
  /**
   * OAuth 2.0 *Web application* client ID for the Gmail consent popup (public, not a secret).
   * Google Cloud Console → APIs & Services → Credentials. Same value as the functions' GMAIL_CLIENT_ID.
   */
  gmailOAuthClientId: '231457872788-9mi04snf3q4tl600ik0ptc4hp5jqcm6c.apps.googleusercontent.com',
  /**
   * Web Push public key (VAPID) for phone/browser notifications. Not a secret.
   * Firebase console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
   */
  fcmVapidKey: 'BLGM3lFC5bhzBJPn6XKze4_IuG26gvBk6qt1cuP6lEdruzDM2iSTrAYgv6W9xVa7WlITenP-mh1ZfI8-H5QAkOU'
};
