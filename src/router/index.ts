import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useGroupsStore } from '@/stores/groups'
import { isRegistrationEnabled } from '@/utils/auth'

/**
 * Build the most common route shape — an auth-gated page with a
 * named route. Centralised so the same `{ path, name, component, meta }`
 * template doesn't get copy-pasted across every entry in the routes
 * array (SonarCloud flagged it as the bulk of the new-code
 * duplication on PR #113).
 */
const authRoute = (
  path: string,
  name: string,
  component: () => Promise<{ default: Component }>,
): RouteRecordRaw => ({
  path,
  name,
  component,
  meta: { requiresAuth: true },
})

/**
 * Mirror of {@link authRoute} for guest-only routes (login,
 * register, password reset). Used less often but kept symmetrical so
 * the helper pair lives next to each other.
 */
const guestRoute = (
  path: string,
  name: string,
  component: () => Promise<{ default: Component }>,
): RouteRecordRaw => ({
  path,
  name,
  component,
  meta: { requiresGuest: true },
})

const router = createRouter({
  history: createWebHistory('/spora/'),
  routes: [
    guestRoute('/login', 'login', () => import('@/pages/LoginPage.vue')),
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/RegisterPage.vue'),
      meta: { requiresGuest: true },
      beforeEnter: async () => {
        if (!(await isRegistrationEnabled())) {
          return { name: 'login' }
        }
      },
    },
    guestRoute('/forgot-password', 'forgot-password', () => import('@/pages/ForgotPasswordPage.vue')),
    {
      // The route is logically public: the API authorizes via selector+token,
      // and the backend returns kind: 'signup'|'change' so the page can branch
      // the UI without a guest-only redirect (which previously blocked
      // email-change confirmation for already-signed-in users).
      path: '/auth/verify/:selector',
      name: 'verify-email',
      component: () => import('@/pages/VerifyEmailPage.vue'),
    },
    guestRoute('/auth/reset-password/:selector', 'reset-password', () => import('@/pages/ResetPasswordPage.vue')),
    authRoute('/', 'dashboard', () => import('@/pages/DashboardPage.vue')),
    authRoute('/account', 'account', () => import('@/pages/AccountPage.vue')),
    authRoute('/agents/:id', 'agent', () => import('@/pages/AgentPage.vue')),
    authRoute('/agents/:id/scheduled-runs', 'scheduled-runs', () => import('@/pages/ScheduledRunsPage.vue')),
    authRoute('/agents/:id/settings', 'agent-settings', () => import('@/pages/AgentSettingsPage.vue')),
    authRoute('/profile', 'profile', () => import('@/pages/ProfileSettingsPage.vue')),
    authRoute('/groups', 'groups', () => import('@/pages/MyGroupsPage.vue')),
    {
      path: '/settings',
      component: () => import('@/pages/settings/GlobalSettingsLayout.vue'),
      meta: { requiresAuth: true },
      redirect: '/settings/overview',
      children: [
        { path: 'overview', name: 'settings-overview', component: () => import('@/pages/settings/SettingsOverviewPage.vue') },
        { path: 'tools', name: 'settings-tools', component: () => import('@/pages/settings/SettingsToolsPage.vue') },
        { path: 'llm', name: 'settings-llm', component: () => import('@/pages/settings/SettingsLLMPage.vue') },
        { path: 'admin/users', name: 'settings-admin-users', component: () => import('@/pages/admin/UsersPage.vue') },
        { path: 'admin/groups', name: 'settings-admin-groups', component: () => import('@/pages/admin/GroupsPage.vue') },
        { path: 'admin/drivers', name: 'settings-admin-drivers', component: () => import('@/pages/admin/DriversSettingsPage.vue') },
        { path: 'admin/tools', name: 'settings-admin-tools', component: () => import('@/pages/admin/ToolsSettingsPage.vue') },
        { path: 'admin/mail-templates', name: 'settings-admin-mail-templates', component: () => import('@/pages/admin/MailTemplatesPage.vue') },
      ],
    },
    authRoute('/tasks/:id', 'task', () => import('@/pages/TaskChatPage.vue')),
    {
      path: '/groups/:id',
      component: () => import('@/components/groups/GroupLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'group-overview', component: () => import('@/pages/groups/GroupOverviewPage.vue') },
        { path: 'members', name: 'group-members', component: () => import('@/pages/groups/GroupMembersPage.vue') },
        { path: 'agents', name: 'group-agents', component: () => import('@/pages/groups/GroupAgentsPage.vue') },
        { path: 'tools', name: 'group-tools', component: () => import('@/pages/groups/GroupToolsPage.vue') },
        { path: 'llm-drivers', name: 'group-llm-drivers', component: () => import('@/pages/groups/GroupLlmDriversPage.vue') },
        { path: 'settings', name: 'group-settings', component: () => import('@/pages/groups/GroupSettingsPage.vue') },
      ],
    },
    {
      path: '/apps',
      meta: { requiresAuth: true },
      redirect: '/apps/plugins',
      children: [
        { path: 'plugins', name: 'plugins', component: () => import('@/apps/plugins/pages/PluginsPage.vue') },
        // Must stay after `plugins` so the router
        // resolves that first. `:rest*` lets the plugin own sub-paths.
        { path: ':appName/:rest*', name: 'plugin-app', component: () => import('@/apps/PluginAppPage.vue') },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const config = useRuntimeConfigStore()
  const groups = useGroupsStore()

  // Both stores self-dedupe concurrent init() calls; the page-reload
  // guarantee comes from the browser recreating the JS heap on reload.
  const inits: Array<Promise<void>> = []
  if (!auth.initialized) {
    inits.push(auth.init())
  }
  if (!config.initialized) {
    inits.push(config.init())
  }
  await Promise.all(inits)

  // Pre-fetch the groups list once auth is known so downstream UIs
  // (CreateAgentDialog owner step, GroupLayout, AgentsPage transfer
  // dropdown) don't show an empty spinner on first interaction. We
  // only fire for authenticated callers — /api/v1/groups returns 401
  // for guests, and the existing router redirect would have already
  // sent them to /login.
  if (auth.user !== null && groups.groups.length === 0 && !groups.loading) {
    groups.fetchGroups().catch(() => {
      // Non-fatal: pages that need groups re-fetch on mount (e.g.
      // GroupsPage), and the dialog owner step also re-fetches on
      // mode change. A failure here just means a brief empty state
      // until the user navigates somewhere that retries.
    })
  }

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && auth.user) {
    return { name: 'dashboard' }
  }
})

export default router
