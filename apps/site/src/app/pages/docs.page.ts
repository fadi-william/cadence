import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';
import { DomSanitizer, Title } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { GUIDE_SECTIONS, GUIDES } from '../docs/guides';
import { RenderedDoc, renderMarkdown } from '../docs/markdown';
import { REPO_BLOB } from '../site';
import { Icon } from '../ui/icon';

/** Guide Markdown by slug, fetched once per page load. Failed fetches are dropped so they can be retried. */
const guideCache = new Map<string, Promise<string>>();

/** Fetches (or reuses) the Markdown of one guide. */
function loadGuide(slug: string): Promise<string> {
  let md = guideCache.get(slug);
  if (!md) {
    md = fetch(`guide/${slug}.md`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    md.catch(() => guideCache.delete(slug));
    guideCache.set(slug, md);
  }
  return md;
}

/**
 * One user guide: a sidebar of all guides by section, the rendered Markdown with loading and error
 * states, previous / next links, an "on this page" table of contents and a link to the source on
 * GitHub. The page title follows the guide's level-1 heading.
 */
@Component({
  selector: 'docs-page',
  imports: [RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './docs.page.html',
})
export class DocsPage {
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  /** Guide slug, bound from the `:slug` route param. */
  readonly slug = input.required<string>();

  protected readonly guides = GUIDES;
  protected readonly sections = GUIDE_SECTIONS;
  protected bySection = (s: string) => GUIDES.filter((g) => g.section === s);

  /** The Markdown is fetched relative to `<base href>` (so it works on GitHub Pages sub-paths) and cached. */
  protected readonly doc = resource({
    params: () => this.slug(),
    loader: ({ params }) => loadGuide(params),
  });

  /**
   * The guide on screen. While the next guide loads, the previous one stays up instead of flashing a
   * loading state; it is only replaced once the new Markdown has arrived (or failed).
   */
  protected readonly rendered = linkedSignal<
    { md: string | undefined; loading: boolean },
    RenderedDoc | null
  >({
    source: () => ({ md: this.doc.value(), loading: this.doc.isLoading() }),
    computation: ({ md, loading }, previous) =>
      md ? renderMarkdown(md) : loading ? (previous?.value ?? null) : null,
  });
  // Our own repository content, rendered at build-time sources: safe to trust.
  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.rendered()?.html ?? ''),
  );

  private readonly index = computed(() => GUIDES.findIndex((g) => g.slug === this.slug()));
  /** Neighbouring guides in {@link GUIDES} order; undefined at either end or for an unknown slug. */
  protected readonly prev = computed(() => GUIDES[this.index() - 1]);
  protected readonly next = computed(() =>
    this.index() >= 0 ? GUIDES[this.index() + 1] : undefined,
  );
  protected readonly sourceUrl = computed(() => `${REPO_BLOB}/docs/guide/${this.slug()}.md`);

  constructor() {
    // Fetch the other guides in the background so switching between them is instant.
    for (const g of GUIDES) void loadGuide(g.slug).catch(() => undefined);
    effect(() => {
      const r = this.rendered();
      if (r) this.title.setTitle(`${r.title} · Cadence docs`);
      // Honour a #fragment after the content has rendered.
      const fragment = this.router.parseUrl(this.router.url).fragment;
      if (r && fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView());
    });
  }

  /**
   * Route internal links rendered from Markdown through the Angular router. In-page `#anchor` links
   * scroll smoothly; new-tab, Cmd and Ctrl clicks keep the browser's default behaviour.
   */
  onContentClick(event: MouseEvent) {
    const a = (event.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || a.target === '_blank' || event.metaKey || event.ctrlKey) return;
    if (href.startsWith('#')) {
      this.scrollTo(event, href.slice(1));
    } else if (href.startsWith('docs/')) {
      event.preventDefault();
      void this.router.navigateByUrl('/' + href);
    }
  }

  /**
   * Smoothly scrolls to the element with `id` and puts `#id` in the address bar without a navigation.
   */
  scrollTo(event: Event, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}#${id}`);
  }
}
