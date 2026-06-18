import { useState, useEffect } from 'react';
import { ChatScreen }      from './components/chat';
import { SettingsScreen }  from './components/settings';
import { NavRail, type Route } from './components/nav-rail';
import { TasksPage }       from './components/pages/TasksPage';
import { AutomationsPage } from './components/pages/AutomationsPage';
import { ConnectionsPage } from './components/pages/ConnectionsPage';
import { LoginsPage }      from './components/pages/LoginsPage';
import { McpPage }         from './components/pages/McpPage';
import { SkillsPage }      from './components/pages/SkillsPage';
import { MemoryPage }      from './components/pages/MemoryPage';
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
  const [route,        setRoute       ] = useState<Route>('chat');
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

  const uid = user?.id ?? 'local';

  return (
    <div id="app-shell" style={{ width: '100%', height: '100%', background: 'var(--bg-app)', color: 'var(--text-primary)', fontFamily: 'var(--font)', display: 'flex', flexDirection: 'row', overflow: 'hidden', position: 'relative' }}>
      <NavRail
        route={route}
        onNavigate={(r) => { setShowSettings(false); setRoute(r); }}
        onOpenSettings={() => setShowSettings(true)}
        userId={uid}
        userEmail={user?.email ?? null}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {route === 'chat'        && <ChatScreen model={model} setModel={setModel} userEmail={user?.email ?? null} userId={user?.id ?? null} credits={credits} onCreditsRefresh={refreshCredits} />}
        {route === 'tasks'       && <TasksPage userId={uid} />}
        {route === 'automations' && <AutomationsPage userId={uid} />}
        {route === 'skills'      && <SkillsPage userId={uid} />}
        {route === 'memory'      && <MemoryPage userId={uid} />}
        {route === 'connections' && <ConnectionsPage />}
        {route === 'logins'      && <LoginsPage />}
        {route === 'mcp'         && <McpPage userId={uid} />}
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
