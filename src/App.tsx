import { useState, useEffect } from 'react';
import { ChatScreen }      from './components/chat';
import { SchedulerScreen } from './components/scheduler';
import { LiveScreen }      from './components/live';
import { SettingsScreen }  from './components/settings';
import { CoworkerScreen }  from './components/coworker';
import { LoginScreen }     from './pages/Login';
import { OnboardingScreen } from './pages/Onboarding';
import { restoreSession, signOut } from './lib/auth';
import { getUserCredits } from './lib/supabase';
import { initDatabase } from './lib/database';
import { installSqlCoworkerBackend } from './lib/coworker/sql-backend';
import { restoreAutomationScheduler } from './lib/automations/scheduler';
import type { AuthUser } from './lib/auth';
import type { UserCredits } from './lib/supabase';

declare global {
  interface Window { __TAURI__?: unknown }
}

type AppState = 'loading' | 'login' | 'onboarding' | 'app';
type Screen   = 'chat' | 'scheduler' | 'overlay' | 'coworker';

async function initStores(userId: string): Promise<void> {
  await initDatabase(userId);
  await installSqlCoworkerBackend();
  await restoreAutomationScheduler(userId);
}

async function getOnboardingComplete(): Promise<boolean> {
  if (localStorage.getItem('onboarding_complete') === 'true') return true;
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('auth.dat');
    const val = await store.get<boolean>('onboarding_complete');
    return val === true;
  } catch {
    return false;
  }
}

export default function App() {
  const [appState,     setAppState    ] = useState<AppState>('loading');
  const [user,         setUser        ] = useState<AuthUser | null>(null);
  const [credits,      setCredits     ] = useState<UserCredits | null>(null);
  const [screen,       setScreen      ] = useState<Screen>('chat');
  const [model,        setModel       ] = useState('core');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    (async () => {
      const restoredUser = await restoreSession();
      if (!restoredUser) {
        setAppState('login');
        return;
      }
      const [fetchedCredits, onboardingDone] = await Promise.all([
        getUserCredits(restoredUser.id),
        getOnboardingComplete(),
        initStores(restoredUser.id),
      ]);
      setUser(restoredUser);
      setCredits(fetchedCredits);
      setAppState(onboardingDone ? 'app' : 'onboarding');
    })();
  }, []);

  async function handleLogin(loggedInUser: AuthUser) {
    const [fetchedCredits, onboardingDone] = await Promise.all([
      getUserCredits(loggedInUser.id),
      getOnboardingComplete(),
      initStores(loggedInUser.id),
    ]);
    setUser(loggedInUser);
    setCredits(fetchedCredits);
    setAppState(onboardingDone ? 'app' : 'onboarding');
  }

  async function handleOnboardingComplete() {
    if (user) {
      const fetchedCredits = await getUserCredits(user.id);
      setCredits(fetchedCredits);
    }
    setAppState('app');
  }

  async function refreshCredits() {
    if (!user) return;
    const fresh = await getUserCredits(user.id);
    setCredits(fresh);
  }

  async function handleSignOut() {
    await signOut();
    setUser(null);
    setCredits(null);
    setShowSettings(false);
    setAppState('login');
  }

  function nav(s: string) {
    if (s === 'settings') { setShowSettings(true); return; }
    setShowSettings(false);
    setScreen(s as Screen);
  }

  if (appState === 'loading') {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-app)', display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }} />
        </div>
      </div>
    );
  }

  if (appState === 'login') {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-app)', fontFamily: 'var(--font)' }}>
        <LoginScreen onLogin={handleLogin} />
      </div>
    );
  }

  if (appState === 'onboarding' && user) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-app)', fontFamily: 'var(--font)' }}>
        <OnboardingScreen user={user} onComplete={handleOnboardingComplete} />
      </div>
    );
  }

  return (
    <div id="app-shell" style={{ width: '100%', height: '100%', background: 'var(--bg-app)', color: 'var(--text-primary)', fontFamily: 'var(--font)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {screen === 'chat'      && <ChatScreen nav={nav} model={model} setModel={setModel} userEmail={user?.email ?? null} userId={user?.id ?? null} credits={credits} onCreditsRefresh={refreshCredits} />}
        {screen === 'scheduler' && <SchedulerScreen nav={nav} />}
        {screen === 'coworker'  && <CoworkerScreen nav={nav} userId={user?.id ?? null} />}
        {screen === 'overlay'   && <LiveScreen nav={nav} />}
      </div>
      {showSettings && (
        <SettingsScreen
          onClose={() => setShowSettings(false)}
          user={user}
          credits={credits}
          onSignOut={handleSignOut}
        />
      )}
    </div>
  );
}
