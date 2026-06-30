import { useState, useEffect } from 'react';
import { ChatScreen }      from './components/chat';
import { SettingsScreen }  from './components/settings';
import { NavRail, type Route } from './components/nav-rail';
import { TasksPage }       from './components/pages/TasksPage';
import { EmailPage }       from './components/pages/EmailPage';
import { AutomationsPage } from './components/pages/AutomationsPage';
import { ConnectionsPage } from './components/pages/ConnectionsPage';
import { LoginsPage }      from './components/pages/LoginsPage';
import { McpPage }         from './components/pages/McpPage';
import { SkillsPage }      from './components/pages/SkillsPage';
import { MemoryPage }      from './components/pages/MemoryPage';
import { ArtifactsPage }   from './components/pages/ArtifactsPage';
import { AdminAssistant }  from './components/admin/AdminAssistant';
import { LoginScreen }     from './pages/Login';
import { OnboardingScreen } from './pages/Onboarding';
import { restoreSession, signOut } from './lib/auth';
import { getUserCredits } from './lib/supabase';
import { initDatabase, adoptOrphanSessions } from './lib/database';
import { installSqlCoworkerBackend } from './lib/coworker/sql-backend';
import { restoreAutomationScheduler } from './lib/automations/scheduler';
import { startXScheduledPostWorker } from './lib/connections/providers/x/scheduled';
import { configureAutomationQueueProcessor } from './lib/automations/agent-processor';
import { restoreDailySummaryScheduler } from './lib/memory/daily-summary';
import { createProject, listProjects, resolveActiveProject, setActiveProjectId as persistActiveProjectId } from './lib/projects/store';
import { adoptLegacyLocalConnectedAccounts } from './lib/connections/connectedAccounts';
import type { AuthUser } from './lib/auth';
import type { UserCredits } from './lib/supabase';
import type { Project } from './lib/projects/types';

declare global {
  interface Window { __TAURI__?: unknown }
}

type AppState = 'loading' | 'login' | 'onboarding' | 'app';

type ProjectState = {
  activeProject: Project | null;
  activeProjectId: string | null;
  projects: Project[];
};

async function initStores(userId: string): Promise<void> {
  await initDatabase(userId);
  adoptLegacyLocalConnectedAccounts(userId);
  await installSqlCoworkerBackend();
  configureAutomationQueueProcessor();
  await restoreAutomationScheduler(userId);
  startXScheduledPostWorker(userId);
  restoreDailySummaryScheduler(userId);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadProjectState(userId: string): Promise<ProjectState> {
  try {
    const active = await withTimeout(resolveActiveProject(userId), 7000, 'Project bootstrap');
    // Legacy chats (created before projects existed) have project_id = NULL and
    // would be hidden once a project is active. Adopt them into the resolved
    // project so the user keeps seeing their previous conversations.
    await adoptOrphanSessions(active.id).catch((err) =>
      console.warn('Could not adopt legacy chats into the active project:', err),
    );
    const projects = await withTimeout(listProjects(userId), 7000, 'Project list');
    return { activeProject: active, activeProjectId: active.id, projects };
  } catch (error) {
    console.warn('Project state unavailable; continuing without project context.', error);
    return { activeProject: null, activeProjectId: null, projects: [] };
  }
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
  // When another surface (Automations, RunMonitor, wizard) asks to open a chat,
  // we switch to the chat route and hand the session id to ChatScreen, which
  // selects it. Single source of truth — no localStorage/reload hacks.
  const [openChatSessionId, setOpenChatSessionId] = useState<string | null>(null);
  const [model,        setModel       ] = useState('core');
  const [showSettings, setShowSettings] = useState(false);
  const [projects,     setProjects    ] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [automationRefreshKey, setAutomationRefreshKey] = useState(0);

  useEffect(() => {
    if (user && !user.isAdmin && route === 'automations') {
      setRoute('chat');
    }
  }, [route, user]);

  // Unify legacy workspace-scoped plumbing (coworker records, automations, skills,
  // gateway) onto the active project: these internal modules scope data by the
  // localStorage 'active_workspace_id' key, so we keep it pointed at the active
  // project id. The project id is the single source of truth; this is just a bridge.
  useEffect(() => {
    if (activeProjectId) localStorage.setItem('active_workspace_id', activeProjectId);
    else localStorage.removeItem('active_workspace_id');
  }, [activeProjectId]);

  useEffect(() => {
    (async () => {
      try {
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
        const projectState = await loadProjectState(restoredUser.id);
        setUser(restoredUser);
        setCredits(fetchedCredits);
        setActiveProject(projectState.activeProject);
        setActiveProjectIdState(projectState.activeProjectId);
        setProjects(projectState.projects);
        setAppState(onboardingDone ? 'app' : 'onboarding');
      } catch (error) {
        console.error('App bootstrap failed.', error);
        setAppState('login');
      }
    })();
  }, []);

  async function handleLogin(loggedInUser: AuthUser) {
    const [fetchedCredits, onboardingDone] = await Promise.all([
      getUserCredits(loggedInUser.id),
      getOnboardingComplete(),
      initStores(loggedInUser.id),
    ]);
    const projectState = await loadProjectState(loggedInUser.id);
    setUser(loggedInUser);
    setCredits(fetchedCredits);
    setActiveProject(projectState.activeProject);
    setActiveProjectIdState(projectState.activeProjectId);
    setProjects(projectState.projects);
    setAppState(onboardingDone ? 'app' : 'onboarding');
  }

  async function refreshProjectsFor(currentUserId = user?.id): Promise<void> {
    if (!currentUserId) return;
    setLoadingProjects(true);
    try {
      const [active, projectList] = await Promise.all([
        withTimeout(resolveActiveProject(currentUserId), 7000, 'Project refresh'),
        withTimeout(listProjects(currentUserId), 7000, 'Project list refresh'),
      ]);
      setActiveProject(active);
      setActiveProjectIdState(active.id);
      setProjects(projectList);
    } finally {
      setLoadingProjects(false);
    }
  }

  async function handleCreateProject(name: string): Promise<void> {
    if (!user) return;
    const project = await createProject(user.id, { name, kind: 'project' });
    setActiveProject(project);
    setActiveProjectIdState(project.id);
    await refreshProjectsFor(user.id);
  }

  async function handleSwitchProject(projectId: string): Promise<void> {
    if (!user) return;
    await persistActiveProjectId(user.id, projectId);
    const projectList = await listProjects(user.id);
    setProjects(projectList);
    setActiveProject(projectList.find((p) => p.id === projectId) ?? null);
    setActiveProjectIdState(projectId);
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
    setProjects([]);
    setActiveProject(null);
    setActiveProjectIdState(null);
    setLoadingProjects(false);
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

  function openChatSession(sessionId: string) {
    setShowSettings(false);
    setRoute('chat');
    setOpenChatSessionId(sessionId);
  }

  return (
    <div id="app-shell" style={{ width: '100%', height: '100%', background: 'var(--bg-app)', color: 'var(--text-primary)', fontFamily: 'var(--font)', display: 'flex', flexDirection: 'row', overflow: 'hidden', position: 'relative' }}>
      <NavRail
        route={route}
        onNavigate={(r) => { setShowSettings(false); setRoute(r); }}
        onOpenSettings={() => setShowSettings(true)}
        userId={uid}
        userEmail={user?.email ?? null}
        isAdmin={user?.isAdmin ?? false}
        projects={projects}
        activeProject={activeProject}
        loadingProjects={loadingProjects}
        onRefreshProjects={refreshProjectsFor}
        onCreateProject={handleCreateProject}
        onSwitchProject={handleSwitchProject}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {route === 'chat'        && <ChatScreen model={model} setModel={setModel} userEmail={user?.email ?? null} userId={user?.id ?? null} projectId={activeProjectId} credits={credits} onCreditsRefresh={refreshCredits} openSessionId={openChatSessionId} onSessionOpened={() => setOpenChatSessionId(null)} />}
        {route === 'tasks'       && <TasksPage userId={uid} />}
        {route === 'email'       && <EmailPage userId={uid} projectId={activeProjectId} />}
        {route === 'automations' && <AutomationsPage userId={uid} projectId={activeProjectId} isAdmin={user?.isAdmin ?? false} refreshKey={automationRefreshKey} onOpenChat={openChatSession} />}
        {route === 'artifacts'   && <ArtifactsPage />}
        {route === 'skills'      && <SkillsPage userId={uid} projectId={activeProjectId} />}
        {route === 'memory'      && <MemoryPage userId={uid} projectId={activeProjectId} />}
        {route === 'connections' && <ConnectionsPage userId={uid} projectId={activeProjectId} isAdmin={user?.isAdmin ?? false} />}
        {route === 'logins'      && <LoginsPage />}
        {route === 'mcp'         && <McpPage userId={uid} projectId={activeProjectId} />}
      </div>
      {showSettings && (
        <SettingsScreen
          onClose={() => setShowSettings(false)}
          user={user}
          credits={credits}
          onSignOut={handleSignOut}
          activeProject={activeProject}
          onProjectsChanged={() => refreshProjectsFor(user?.id)}
        />
      )}
      {user?.isAdmin && (
        <AdminAssistant
          userId={uid}
          projectId={activeProjectId}
          isAdmin={user.isAdmin}
          onCreated={() => setAutomationRefreshKey((value) => value + 1)}
          onOpenAutomations={() => { setShowSettings(false); setRoute('automations'); }}
        />
      )}
    </div>
  );
}
