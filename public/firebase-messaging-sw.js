/* SmartShare Budget — background push handler (Firebase Cloud Messaging).
 * Shows notifications while the app is closed; tapping one opens the app at the right page.
 * The config below is the same public web config as src/environments/environment.ts. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBNGnXXho0kHwmEUTFJKtM5rMeNzLckWB8',
  authDomain: 'mybudgetapp-54c43.firebaseapp.com',
  projectId: 'mybudgetapp-54c43',
  storageBucket: 'mybudgetapp-54c43.firebasestorage.app',
  messagingSenderId: '231457872788',
  appId: '1:231457872788:web:4fabec01905c59479a0d81',
});

// Messages with a `notification` payload are displayed automatically by the SDK,
// and fcmOptions.link opens the app on tap. Nothing else is needed here.
firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
