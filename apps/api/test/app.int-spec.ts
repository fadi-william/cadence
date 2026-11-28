import { createHmac } from 'node:crypto';
import { Harness, createHarness, refreshCookie, resetDb } from './app-harness';
import { SetupService } from '../src/setup/setup.service';

const ADMIN_PW = 'correct-horse-battery';

describe('Cadence API (integration)', () => {
  let h: Harness;
  let adminToken: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    h = await createHarness();
    await resetDb(h.prisma);
    await h.app.get(SetupService).onApplicationBootstrap();
  });
  afterAll(() => h.close());

  async function login(email: string, password: string) {
    const res = await h.http().post('/api/auth/login').send({ email, password }).expect(200);
    return { token: res.body.accessToken as string, cookie: refreshCookie(res)! };
  }

  describe('first launch', () => {
    it('reports setup mode and completes exactly once', async () => {
      const status = await h.http().get('/api/setup/status').expect(200);
      expect(status.body).toEqual({ needsSetup: true, adminEmail: 'admin@cadence.local', tokenRequired: false });

      await h.http().get('/api/members').expect(401);
      await h
        .http()
        .post('/api/setup/complete')
        .send({ name: 'Admin', email: 'admin@cadence.local', password: 'short' })
        .expect(400);

      const res = await h
        .http()
        .post('/api/setup/complete')
        .send({ name: 'Hoda Admin', email: 'admin@cadence.local', password: ADMIN_PW })
        .expect(201);
      expect(res.body.user).toMatchObject({ role: 'ADMIN', name: 'Hoda Admin' });
      expect(refreshCookie(res)).toMatch(/^cadence_rt=/);
      expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
      adminToken = res.body.accessToken;

      await h
        .http()
        .post('/api/setup/complete')
        .send({ name: 'Intruder', email: 'intruder@cadence.local', password: 'another-long-password' })
        .expect(409);
      expect((await h.http().get('/api/setup/status')).body.needsSetup).toBe(false);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
      const { cookie } = await login('admin@cadence.local', ADMIN_PW);
      const first = await h.http().post('/api/auth/refresh').set('Cookie', cookie).expect(200);
      const rotated = refreshCookie(first)!;
      expect(rotated).not.toEqual(cookie);

      // Within the grace window a parallel tab replaying the old token still gets an access token.
      await h.http().post('/api/auth/refresh').set('Cookie', cookie).expect(200);

      // Outside the grace window, replay = theft: the whole family is revoked.
      await h.prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await h.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
      await h.http().post('/api/auth/refresh').set('Cookie', rotated).expect(401);
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'auth.refresh_reuse_detected' } });
      expect(audit).not.toBeNull();
    });

    it('logout revokes the session', async () => {
      const { cookie } = await login('admin@cadence.local', ADMIN_PW);
      await h.http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      await h.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });
  });

  describe('hierarchy, scoping and passwords', () => {
    let tlId: string;
    let em1: { id: string; token: string };
    let em2Id: string;
    let tlToken: string;

    it('admin creates a tribe lead; the tribe lead creates managers under themselves', async () => {
      tlId = (
        await h
          .http()
          .post('/api/users')
          .set(auth(adminToken))
          .send({
            email: 'tl@cadence.local',
            name: 'Ahmed Mostafa',
            role: 'TRIBE_LEAD',
            password: 'tribe-lead-pass-1',
            tribeName: 'Retail',
          })
          .expect(201)
      ).body.id;
      tlToken = (await login('tl@cadence.local', 'tribe-lead-pass-1')).token;

      // Tribe leads cannot create tribe leads.
      await h
        .http()
        .post('/api/users')
        .set(auth(tlToken))
        .send({ email: 'yousef@cadence.local', name: 'Yousef', role: 'TRIBE_LEAD', password: 'tribe-lead-pass-1' })
        .expect(403);

      const mk = async (email: string, name: string) =>
        (
          await h
            .http()
            .post('/api/users')
            .set(auth(tlToken))
            .send({ email, name, role: 'ENGINEERING_MANAGER', password: 'manager-pass-123' })
            .expect(201)
        ).body;
      const e1 = await mk('em1@cadence.local', 'Michael Ramzy');
      expect(e1.reportsToId).toBe(tlId);
      em2Id = (await mk('em2@cadence.local', 'Rana Abdelaziz')).id;
      em1 = { id: e1.id, token: (await login('em1@cadence.local', 'manager-pass-123')).token };
    });

    it('managers only see their own members', async () => {
      await h.http().post('/api/members').set(auth(em1.token)).send({ name: 'Mina Samir' }).expect(201);
      await h
        .http()
        .post('/api/members')
        .set(auth(tlToken))
        .send({ name: 'Bassam Adel', managerId: em2Id })
        .expect(201);

      const mine = await h.http().get('/api/members').set(auth(em1.token)).expect(200);
      expect(mine.body.map((m: { name: string }) => m.name)).toEqual(['Mina Samir']);
      await h.http().post('/api/members').set(auth(em1.token)).send({ name: 'Sneaky', managerId: em2Id }).expect(403);

      const tl = await h.http().get('/api/members').set(auth(tlToken)).expect(200);
      expect(tl.body).toHaveLength(2);
      const tree = await h.http().get('/api/org/tree').set(auth(em1.token)).expect(200);
      expect(tree.body.tribeLeads[0].managers).toHaveLength(1);
    });

    it('non-admins cannot manage integrations or read the audit log', async () => {
      await h.http().post('/api/integrations').set(auth(tlToken)).send({}).expect(403);
      await h.http().get('/api/audit').set(auth(em1.token)).expect(403);
    });

    it('reset links are single-use and revoke existing sessions', async () => {
      const { cookie } = await login('em1@cadence.local', 'manager-pass-123');
      const link = await h.http().post(`/api/users/${em1.id}/reset-link`).set(auth(tlToken)).expect(201);
      const token = new URL(link.body.url).searchParams.get('token')!;
      await h.http().post('/api/auth/reset-password').send({ token, password: 'a-brand-new-password' }).expect(204);
      await h.http().post('/api/auth/reset-password').send({ token, password: 'another-new-password' }).expect(400);
      await h.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
      await login('em1@cadence.local', 'a-brand-new-password');
      // EMs cannot create reset links for anyone.
      await h.http().post(`/api/users/${em2Id}/reset-link`).set(auth(em1.token)).expect(403);
    });

    it('change-password requires the current password', async () => {
      const { token } = await login('em1@cadence.local', 'a-brand-new-password');
      await h
        .http()
        .post('/api/auth/change-password')
        .set(auth(token))
        .send({ currentPassword: 'wrong', newPassword: 'yet-another-password' })
        .expect(400);
      await h
        .http()
        .post('/api/auth/change-password')
        .set(auth(token))
        .send({ currentPassword: 'a-brand-new-password', newPassword: 'yet-another-password' })
        .expect(200);
    });

    it('forgot-password does not reveal whether an account exists', async () => {
      const known = await h.http().post('/api/auth/forgot-password').send({ email: 'em1@cadence.local' }).expect(202);
      const unknown = await h
        .http()
        .post('/api/auth/forgot-password')
        .send({ email: 'ghost@cadence.local' })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
    });

    it('metrics roll up per team and tribe within scope', async () => {
      const conn = await h.prisma.integrationConnection.create({
        data: {
          name: 'Seed',
          provider: 'AZURE_DEVOPS',
          baseUrl: 'https://dev.azure.com/cadence',
          encryptedSecret: 'v1:x:y:z',
          features: ['SOURCE_CONTROL', 'DEPLOYMENTS'],
        },
      });
      const members = await h.prisma.member.findMany();
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      for (const m of members) {
        await h.prisma.dailyMetric.create({
          data: {
            memberId: m.id,
            connectionId: conn.id,
            date: today,
            commits: 5,
            prsReviewed: 2,
            issuesCompleted: 1,
          },
        });
      }
      // One ticket held by both members (one per team): each team counts it, the tribe counts it once.
      await h.prisma.workItem.create({
        data: {
          connectionId: conn.id,
          key: 'CORE-1',
          date: today,
          storyPoints: 3,
          cycleTimeHours: 5,
          contributors: { create: members.map((m) => ({ memberId: m.id })) },
        },
      });

      const teams = await h.http().get('/api/metrics/rollup?groupBy=manager').set(auth(adminToken)).expect(200);
      expect(teams.body.rows).toHaveLength(2);
      expect(teams.body.rows[0].totals).toMatchObject({
        commits: 5,
        prsReviewed: 2,
        issuesCompleted: 1,
        storyPoints: 3,
        cycleTimeHoursAvg: 5,
      });
      const tribes = await h.http().get('/api/metrics/rollup?groupBy=tribe').set(auth(adminToken)).expect(200);
      expect(tribes.body.rows).toEqual([
        expect.objectContaining({
          name: 'Retail',
          memberCount: 2,
          totals: expect.objectContaining({ commits: 10, issuesCompleted: 1 }),
        }),
      ]);
      expect(tribes.body.trend.at(-1)).toMatchObject({ commits: 10, issuesCompleted: 1 });
      const em = await h.http().get('/api/metrics/summary').set(auth(em1.token)).expect(200);
      expect(em.body.totals.commits).toBe(5);
      expect(em.body.previous.commits).toBe(0);

      // Impossible calendar dates fall back to the default range instead of failing.
      const fallback = await h.http().get('/api/metrics/summary?to=2026-13-01').set(auth(em1.token)).expect(200);
      expect(fallback.body).toEqual(em.body);
      await h.http().get('/api/dora/summary?from=2026-02-30').set(auth(em1.token)).expect(200);

      // Combined per-person view: totals plus a per-platform breakdown.
      const mina = members.find((m) => m.name === 'Mina Samir')!;
      const person = await h.http().get(`/api/metrics/members/${mina.id}`).set(auth(em1.token)).expect(200);
      expect(person.body.totals.commits).toBe(5);
      expect(person.body.sources).toEqual([
        expect.objectContaining({
          connectionId: conn.id,
          provider: 'AZURE_DEVOPS',
          totals: expect.objectContaining({ commits: 5 }),
        }),
      ]);
      await h.http().get(`/api/metrics/members/${mina.id}`).set(auth(tlToken)).expect(200);
      const omar = members.find((m) => m.name === 'Bassam Adel')!;
      await h.http().get(`/api/metrics/members/${omar.id}`).set(auth(em1.token)).expect(404);
    });

    it('DORA summary computes frequency, CFR, lead time and MTTR within scope', async () => {
      const conn = await h.prisma.integrationConnection.findFirstOrThrow();
      const svc = await h.prisma.deliveryService.create({
        data: { connectionId: conn.id, name: 'api', managerId: em1.id },
      });
      const other = await h.prisma.deliveryService.create({
        data: { connectionId: conn.id, name: 'web', managerId: em2Id },
      });
      const base = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime() - 3 * 864e5;
      const dep = (serviceId: string, id: string, h_: number, status: 'SUCCESS' | 'FAILED', lead: number | null) => ({
        serviceId,
        externalId: id,
        environment: 'production',
        status,
        finishedAt: new Date(base + h_ * 36e5),
        leadTimeHours: lead,
      });
      await h.prisma.deployment.createMany({
        data: [
          dep(svc.id, '1', 1, 'SUCCESS', 10),
          dep(svc.id, '2', 2, 'FAILED', null),
          dep(svc.id, '3', 4, 'SUCCESS', 20),
          dep(svc.id, '4', 30, 'SUCCESS', 30),
          dep(other.id, '5', 5, 'FAILED', null),
        ],
      });
      const mine = await h.http().get('/api/dora/summary').set(auth(em1.token)).expect(200);
      expect(mine.body).toMatchObject({
        deployments: 4,
        failedDeployments: 1,
        changeFailureRate: 0.25,
        leadTimeHoursMedian: 20,
        mttrHours: 2,
        ratings: { leadTime: 'ELITE', changeFailureRate: 'LOW', mttr: 'HIGH' },
      });
      expect(mine.body.services.map((s: { name: string }) => s.name)).toEqual(['api']);
      const all = await h.http().get('/api/dora/summary').set(auth(adminToken)).expect(200);
      expect(all.body.deployments).toBe(5);

      // Review wait follows the PR authors' teams, not services.
      const mina = await h.prisma.member.findFirstOrThrow({ where: { managerId: em1.id } });
      const other2 = await h.prisma.member.findFirstOrThrow({ where: { managerId: em2Id } });
      const day = new Date(base);
      await h.prisma.reviewedPullRequest.createMany({
        data: [
          { connectionId: conn.id, key: 'r-1', memberId: mina.id, date: day, waitHours: 2 },
          { connectionId: conn.id, key: 'r-2', memberId: mina.id, date: day, waitHours: 6 },
          { connectionId: conn.id, key: 'r-3', memberId: mina.id, date: day, waitHours: 40 },
          { connectionId: conn.id, key: 'r-4', memberId: other2.id, date: day, waitHours: 100 },
        ],
      });
      const waitMine = await h.http().get('/api/dora/summary').set(auth(em1.token)).expect(200);
      expect(waitMine.body).toMatchObject({ reviewWaitHoursMedian: 6, reviewedPullRequests: 3 });
      const waitAll = await h.http().get('/api/dora/summary').set(auth(adminToken)).expect(200);
      expect(waitAll.body).toMatchObject({ reviewWaitHoursMedian: 23, reviewedPullRequests: 4 });
      const person = await h.http().get(`/api/metrics/members/${mina.id}`).set(auth(em1.token)).expect(200);
      expect(person.body.reviewWait).toEqual({ hoursMedian: 6, pullRequests: 3, previousHoursMedian: null });

      // Tribe lead may move a service between their own teams; managers may not.
      await h.http().patch(`/api/dora/services/${other.id}`).set(auth(tlToken)).send({ managerId: em1.id }).expect(200);
      await h
        .http()
        .patch(`/api/dora/services/${other.id}`)
        .set(auth(em1.token))
        .send({ managerId: em2Id })
        .expect(403);
    });
  });

  describe('integrations and webhooks', () => {
    let connId: string;

    it('stores secrets encrypted and never returns them', async () => {
      const res = await h
        .http()
        .post('/api/integrations')
        .set(auth(adminToken))
        .send({
          name: 'ADO',
          provider: 'AZURE_DEVOPS',
          baseUrl: 'https://dev.azure.invalid/cadence',
          secret: 'ado_pat_supersecret',
          config: { projects: ['Core'] },
        })
        .expect(201);
      connId = res.body.id;
      expect(JSON.stringify(res.body)).not.toContain('ado_pat_supersecret');
      const row = await h.prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } });
      expect(row.encryptedSecret.startsWith('v1:')).toBe(true);
      expect(row.encryptedSecret).not.toContain('ado_pat_supersecret');
    });

    it('queues manual syncs and records failures', async () => {
      const run = await h
        .http()
        .post(`/api/integrations/${connId}/sync`)
        .set(auth(adminToken))
        .send({ days: 2 })
        .expect(200);
      expect(run.body).toMatchObject({ status: 'QUEUED', trigger: 'manual' });
      await vi.waitFor(
        async () => {
          const r = await h.http().get(`/api/integrations/${connId}/runs/${run.body.id}`).set(auth(adminToken));
          expect(r.body.status).toBe('FAILED');
          expect(r.body.error).toMatch(/dev\.azure\.invalid/);
        },
        { timeout: 15_000, interval: 250 },
      );
    });

    it('verifies Azure DevOps webhook tokens and debounces bursts into one sync', async () => {
      await h.http().post(`/api/webhooks/${connId}`).send({}).expect(404); // not enabled yet
      const { body } = await h
        .http()
        .post(`/api/integrations/${connId}/webhook`)
        .set(auth(adminToken))
        .send({})
        .expect(200);

      await h.http().post(`/api/webhooks/${connId}`).set('X-Cadence-Token', 'wrong').send({}).expect(401);
      for (let i = 0; i < 3; i++) {
        await h
          .http()
          .post(`/api/webhooks/${connId}`)
          .set('X-Cadence-Token', body.secret)
          .send({ eventType: 'git.push', createdDate: new Date().toISOString() })
          .expect(202);
      }
      await vi.waitFor(
        async () => {
          const runs = await h.prisma.syncRun.findMany({ where: { connectionId: connId, trigger: 'webhook' } });
          expect(runs).toHaveLength(1);
        },
        { timeout: 5_000, interval: 100 },
      );
    });

    it('verifies Jira HMAC-signed webhooks', async () => {
      const jira = await h
        .http()
        .post('/api/integrations')
        .set(auth(adminToken))
        .send({
          name: 'Jira',
          provider: 'JIRA',
          baseUrl: 'https://cadence.atlassian.invalid',
          secret: 'tok',
          config: { deployment: 'cloud' },
        })
        .expect(201);
      const { body } = await h
        .http()
        .post(`/api/integrations/${jira.body.id}/webhook`)
        .set(auth(adminToken))
        .send({})
        .expect(200);

      // Provided secrets are trimmed before the length checks.
      const setSecret = (secret: string) =>
        h.http().post(`/api/integrations/${jira.body.id}/webhook`).set(auth(adminToken)).send({ secret });
      await setSecret('  abc   ').expect(400);
      await setSecret('        ').expect(400);
      const padded = await setSecret('  signing-secret  ').expect(200);
      expect(padded.body.secret).toBe('signing-secret');
      // Restore the generated secret the rest of this test signs with.
      await h
        .http()
        .post(`/api/integrations/${jira.body.id}/webhook`)
        .set(auth(adminToken))
        .send({ secret: body.secret })
        .expect(200);
      const payload = JSON.stringify({ webhookEvent: 'jira:issue_updated', timestamp: Date.now() });
      const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      const send = (sig: string) =>
        h
          .http()
          .post(`/api/webhooks/${jira.body.id}`)
          .set('Content-Type', 'application/json')
          .set('X-Hub-Signature', sig)
          .send(payload);
      await send(sign('wrong')).expect(401);
      await send(sign(body.secret)).expect(202);
    });

    it('turns features off keeping or removing their data', async () => {
      const created = await h
        .http()
        .post('/api/integrations')
        .set(auth(adminToken))
        .send({
          name: 'Toggles',
          provider: 'AZURE_DEVOPS',
          baseUrl: 'https://dev.azure.invalid/toggles',
          secret: 'pat',
          features: ['SOURCE_CONTROL', 'DEPLOYMENTS'],
        })
        .expect(201);
      const id: string = created.body.id;
      expect(created.body.features).toEqual(['SOURCE_CONTROL', 'DEPLOYMENTS']);
      const member = await h.prisma.member.findFirstOrThrow();
      const date = new Date('2026-11-01T00:00:00Z');
      await h.prisma.dailyMetric.create({ data: { memberId: member.id, connectionId: id, date, commits: 4 } });
      await h.prisma.deliveryService.create({ data: { connectionId: id, name: 'api' } });
      const patch = (body: object) => h.http().patch(`/api/integrations/${id}`).set(auth(adminToken)).send(body);

      // Keep history: source control stops syncing, its numbers stay.
      const kept = await patch({ features: ['DEPLOYMENTS'] }).expect(200);
      expect(kept.body.features).toEqual(['DEPLOYMENTS']);
      expect(await h.prisma.dailyMetric.findFirst({ where: { connectionId: id } })).toMatchObject({ commits: 4 });

      // Remove data: deployments' services go, and data can only be removed for a feature being turned off.
      await patch({ features: ['SOURCE_CONTROL'], removeDataFor: ['SOURCE_CONTROL'] }).expect(400);
      await patch({ features: ['SOURCE_CONTROL'], removeDataFor: ['DEPLOYMENTS'] }).expect(200);
      expect(await h.prisma.deliveryService.count({ where: { connectionId: id } })).toBe(0);
      await patch({ features: ['DEPLOYMENTS'], removeDataFor: ['SOURCE_CONTROL'] }).expect(200);
      expect(await h.prisma.dailyMetric.count({ where: { connectionId: id } })).toBe(0);

      await patch({ features: [] }).expect(400);
      await patch({ features: ['NOT_A_FEATURE'] }).expect(400);
      await h.http().delete(`/api/integrations/${id}`).set(auth(adminToken)).expect(204);
    });

    it('records an audit trail with actors', async () => {
      const page = await h.http().get('/api/audit?limit=5').set(auth(adminToken)).expect(200);
      expect(page.body.items).toHaveLength(5);
      expect(page.body.nextCursor).toBeTruthy();
      const next = await h
        .http()
        .get(`/api/audit?limit=5&cursor=${page.body.nextCursor}`)
        .set(auth(adminToken))
        .expect(200);
      expect(next.body.items[0].id).not.toEqual(page.body.items[4].id);
      const actions = (await h.prisma.auditLog.findMany()).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['setup.completed', 'user.created', 'integration.created', 'auth.password_reset']),
      );
    });
  });
});
