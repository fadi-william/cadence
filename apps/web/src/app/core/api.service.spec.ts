import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiService, errorMessage } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('GETs under /api and resolves with the body', async () => {
    const p = api.setupStatus();
    const req = http.expectOne('/api/setup/status');
    expect(req.request.method).toBe('GET');
    req.flush({ needsSetup: true });
    await expect(p).resolves.toEqual({ needsSetup: true });
  });

  it('drops undefined, null and empty query params', async () => {
    const p = api.summary('2024-01-01', undefined, '');
    const req = http.expectOne((r) => r.url === '/api/metrics/summary');
    expect(req.request.params.keys()).toEqual(['from']);
    expect(req.request.params.get('from')).toBe('2024-01-01');
    req.flush({});
    await p;
  });

  it('stringifies numeric params and applies defaults', async () => {
    const p = api.audit(null, 'User');
    const req = http.expectOne((r) => r.url === '/api/audit');
    expect(req.request.params.get('cursor')).toBeNull();
    expect(req.request.params.get('entityType')).toBe('User');
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ items: [], nextCursor: null });
    await p;
  });

  it('sends users?role only when given', async () => {
    const all = api.users();
    http.expectOne((r) => r.url === '/api/users' && r.params.keys().length === 0).flush([]);
    await all;
    const admins = api.users('ADMIN');
    http.expectOne((r) => r.url === '/api/users' && r.params.get('role') === 'ADMIN').flush([]);
    await admins;
  });

  it('POSTs with credentials (refresh cookie) and an empty body by default', async () => {
    const p = api.refresh();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({});
    req.flush({ accessToken: 't' });
    await expect(p).resolves.toEqual({ accessToken: 't' });
  });

  it('login posts the credentials', async () => {
    const p = api.login({ email: 'a@b.c', password: 'pw' });
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'pw' });
    req.flush({});
    await p;
  });

  it('uses PATCH, PUT and DELETE for updates', async () => {
    const a = api.updateMember('m1', { name: 'X' } as never);
    const pa = http.expectOne('/api/members/m1');
    expect(pa.request.method).toBe('PATCH');
    expect(pa.request.body).toEqual({ name: 'X' });
    pa.flush({});

    const b = api.linkIdentity('m1', 'c1', { externalId: 'e' } as never);
    const pu = http.expectOne('/api/members/m1/identities/c1');
    expect(pu.request.method).toBe('PUT');
    pu.flush({});

    const c = api.deleteIntegration('i1');
    const de = http.expectOne('/api/integrations/i1');
    expect(de.request.method).toBe('DELETE');
    de.flush(null);
    await Promise.all([a, b, c]);
  });

  it('syncIntegration defaults to 14 days', async () => {
    const p = api.syncIntegration('i1');
    const req = http.expectOne('/api/integrations/i1/sync');
    expect(req.request.body).toEqual({ days: 14 });
    req.flush({});
    await p;
  });

  it('setWebhookSecret only sends a secret when given', async () => {
    const a = api.setWebhookSecret('i1');
    http.expectOne('/api/integrations/i1/webhook').flush({});
    await a;
    const b = api.setWebhookSecret('i1', 's3cret');
    const req = http.expectOne('/api/integrations/i1/webhook');
    expect(req.request.body).toEqual({ secret: 's3cret' });
    req.flush({});
    await b;
  });

  it('setServiceOwner can clear the owner', async () => {
    const p = api.setServiceOwner('s1', null);
    const req = http.expectOne('/api/dora/services/s1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ managerId: null });
    req.flush({});
    await p;
  });

  it('rejects with the HttpErrorResponse on failure', async () => {
    const p = api.me();
    http
      .expectOne('/api/auth/me')
      .flush({ message: 'nope' }, { status: 401, statusText: 'Unauthorized' });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(HttpErrorResponse);
    expect(errorMessage(err)).toBe('nope');
  });
});

describe('errorMessage', () => {
  it('prefers the API error message', () => {
    expect(errorMessage({ error: { message: 'Bad e-mail' }, message: 'Http failure' })).toBe(
      'Bad e-mail',
    );
  });
  it('joins validation message arrays', () => {
    expect(errorMessage({ error: { message: ['a is required', 'b too short'] } })).toBe(
      'a is required, b too short',
    );
  });
  it('falls back to the error message, then a generic text', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({})).toBe('Something went wrong');
    expect(errorMessage(null)).toBe('Something went wrong');
    expect(errorMessage(undefined)).toBe('Something went wrong');
  });
});
