import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getRemoteConfig } from 'firebase/remote-config';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { REMOTE_CONFIG_DEFAULTS } from './remoteConfigDefaults';

// Firebase web config is a public client identifier, not a secret. Access is protected by
// App Check, Firestore rules, and API key restrictions in Google Cloud.
const firebaseConfig = {
  apiKey: 'AIzaSyAdO37Oh2L-9TaD_HGqyDz5w60y8RSC-oY',
  authDomain: 'buildhybridai-2026-fdbba.firebaseapp.com',
  projectId: 'buildhybridai-2026-fdbba',
  storageBucket: 'buildhybridai-2026-fdbba.firebasestorage.app',
  messagingSenderId: '508771723242',
  appId: '1:508771723242:web:205cb0b73c72309dc7f493',
};

export const app = initializeApp(firebaseConfig);

// App Check. In development, set VITE_APPCHECK_DEBUG=true in .env.local (never committed);
// the SDK then prints a debug token to register in the Firebase console.
// Provider for the deployed build: reCAPTCHA Enterprise (Fraud Defense). Its site key goes in
// VITE_RECAPTCHA_ENTERPRISE_SITE_KEY; until it exists App Check stays off outside debug mode.
const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;
if (import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
if (siteKey || import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey ?? 'debug-only'),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);

// Local emulators for the privacy e2e test (VITE_USE_EMULATORS=true, never set in production).
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export const remoteConfig = getRemoteConfig(app);
remoteConfig.defaultConfig = REMOTE_CONFIG_DEFAULTS;

export async function ensureSignedIn() {
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}
