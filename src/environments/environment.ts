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
  gmailOAuthClientId: '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'
};
