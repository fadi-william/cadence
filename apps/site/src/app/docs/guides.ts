/** The user guides rendered from docs/guide/*.md (copied to /guide at build time). */
export interface Guide {
  /** Markdown file name without `.md`; also the `/docs/:slug` route segment. */
  slug: string;
  title: string;
  /** One-line description for guide listings. */
  summary: string;
  /** Name of an `app-icon` icon. */
  icon: string;
  /** Sidebar group; one of {@link GUIDE_SECTIONS}. */
  section: 'Start here' | 'Integrations' | 'Reference';
}

/** All guides, in reading order (used for the sidebar and the previous / next links). */
export const GUIDES: Guide[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'Install Cadence, first launch, roles and configuration.',
    icon: 'rocket',
    section: 'Start here',
  },
  {
    slug: 'metrics',
    title: 'How metrics work',
    summary: 'Combined profiles, DORA ratings and responsible use.',
    icon: 'dashboard',
    section: 'Start here',
  },
  {
    slug: 'jira',
    title: 'Connect Jira',
    summary: 'API tokens, linking people, story points and webhooks.',
    icon: 'ticket',
    section: 'Integrations',
  },
  {
    slug: 'azure-devops',
    title: 'Connect Azure DevOps',
    summary: 'PAT scopes, deployments for DORA and service hooks.',
    icon: 'commit',
    section: 'Integrations',
  },
  {
    slug: 'adapters',
    title: 'Add a provider',
    summary: 'Write an adapter for GitHub, GitLab, Linear or your own tool.',
    icon: 'puzzle',
    section: 'Reference',
  },
];

/** Sidebar groups, in display order. */
export const GUIDE_SECTIONS = ['Start here', 'Integrations', 'Reference'] as const;
