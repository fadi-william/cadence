import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { REPO_URL } from '../site';
import { Icon } from '../ui/icon';
import { ProviderIcon } from '../ui/provider-icon';
import { IphoneFrame } from '../ui/iphone-frame';
import { AutoplayVideo } from '../ui/autoplay-video';

/** A card in the features grid. */
interface Feature {
  /** Name of an `app-icon` icon. */
  icon: string;
  /** CSS colour for the icon bubble, set as the `--tone` custom property. */
  tone: string;
  title: string;
  text: string;
}

/** Quick-start shell commands shown and copied on the page: clone, set secrets, start Docker. */
const QUICK_START = `git clone ${REPO_URL}.git && cd Cadence
export JWT_SECRET=$(openssl rand -base64 48) APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose --profile app up -d --build`;

/**
 * Landing page: hero, features grid, the combined profile, DORA and mobile showcases, the
 * three-step setup (with the quick-start commands and links to the guides), privacy points and a
 * closing call to action.
 */
@Component({
  selector: 'home-page',
  imports: [RouterLink, Icon, ProviderIcon, IphoneFrame, AutoplayVideo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.page.html',
})
export class HomePage {
  protected readonly repo = REPO_URL;
  protected readonly quickStart = QUICK_START;
  protected readonly copied = signal(false);

  protected readonly features: Feature[] = [
    {
      icon: 'org',
      tone: 'var(--color-primary)',
      title: 'Your organization, as it is',
      text: 'Tribes, tribe leads, engineering managers and their people. Everyone signs in to exactly their own slice.',
    },
    {
      icon: 'layers',
      tone: 'var(--color-secondary)',
      title: 'One profile per person',
      text: 'Jira issues and Azure DevOps commits, pull requests and reviews merged into one timeline and scorecard.',
    },
    {
      icon: 'rocket',
      tone: 'var(--color-info)',
      title: 'DORA out of the box',
      text: 'Deployment frequency, lead time, change failure rate and time to restore from your pipelines.',
    },
    {
      icon: 'dashboard',
      tone: 'var(--color-success)',
      title: 'Teams and tribes',
      text: 'Switch between people, teams and tribes over any date range, with trends against the previous period.',
    },
    {
      icon: 'refresh',
      tone: 'var(--color-warning)',
      title: 'Always fresh',
      text: 'Nightly syncs, one-click backfills and optional webhooks that update the affected days within a minute.',
    },
    {
      icon: 'puzzle',
      tone: 'var(--color-accent)',
      title: 'Extensible',
      text: 'Add GitHub, GitLab, Linear or an in-house tool by writing a single adapter class.',
    },
  ];

  protected readonly profilePoints = [
    'A combined timeline of code and completed work',
    'A six-month activity calendar at a glance',
    'Each platform’s share, with its own numbers',
    'Every metric compared with the previous period',
  ];

  protected readonly dora = [
    { label: 'Deployment frequency', text: 'Successful deploys per day' },
    { label: 'Lead time', text: 'Commit → production, median' },
    { label: 'Change failure rate', text: 'Failed ÷ all deployments' },
    { label: 'Time to restore', text: 'Failure → next good deploy' },
  ];

  protected readonly steps = [
    {
      title: 'Deploy',
      text: 'Run three commands with Docker. A guided welcome screen creates your admin account.',
      cta: 'Install Cadence',
      link: '/docs/getting-started',
    },
    {
      title: 'Connect',
      text: 'Add Jira and Azure DevOps with read-only tokens. Tokens are encrypted at rest.',
      cta: 'Connect your tools',
      link: '/docs/jira',
    },
    {
      title: 'Link people',
      text: 'Build your tribes and teams, link each person’s accounts, and run your first sync.',
      cta: 'See how metrics work',
      link: '/docs/metrics',
    },
  ];

  protected readonly privacy = [
    {
      icon: 'server',
      title: 'Self-hosted',
      text: 'Runs on your infrastructure. Your delivery data never leaves it.',
    },
    {
      icon: 'eye',
      title: 'Read-only',
      text: 'Cadence only reads from Jira and Azure DevOps, with the smallest scopes.',
    },
    {
      icon: 'lock',
      title: 'Encrypted',
      text: 'Integration tokens are encrypted at rest and never shown again.',
    },
    {
      icon: 'history',
      title: 'Audited',
      text: 'Every sign-in, change and sync lands in the audit log.',
    },
  ];

  /** Copies the quick-start commands and shows "Copied" for 1.5 s; no-op without a clipboard. */
  async copy() {
    try {
      await navigator.clipboard.writeText(this.quickStart);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
}
