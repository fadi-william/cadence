/**
 * Demo data for exploring the UI without real integrations:
 *   `npm run db:seed:demo -w @cadence/api`
 * Creates 2 tribes, 4 teams, 14 members, 60 days of activity and production deployments
 * under two disabled demo connections (Azure DevOps + Jira). Safe to re-run (it replaces its own data).
 * All demo accounts use the password "demo-password-123".
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DAY = 864e5;
let seed = 42;
/** Seeded Park-Miller generator in [0, 1), so every run produces the same demo data. */
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
/**
 * A second seeded generator for review waits, so adding them left every other demo number unchanged.
 */
let waitSeed = 7;
const waitRand = () => ((waitSeed = (waitSeed * 16807) % 2147483647) - 1) / 2147483646;
/**
 * Hours a demo PR waits for its first review: mostly a few hours, sometimes a day or two (exponential with
 * the given mean, at least 15 minutes).
 */
const reviewWait = (meanHours: number) => Math.max(0.25, -Math.log(1 - waitRand()) * meanHours);

/** Random integer between `min` and `max`, both inclusive. */
const pick = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

/** E-mail endings of demo accounts: the current one, then the one older seeds used. */
const DEMO_EMAIL_SUFFIXES = ['@demo.cadence.local', '@demo.cadence'];

/** Tribe lead, tribe, teams (engineering manager, members, delivery services) to create. */
const ORG = [
  {
    lead: ['Ahmed Mostafa', 'ahmed@demo.cadence.local'],
    tribe: 'Retail',
    teams: [
      {
        em: ['Michael Ramzy', 'michael@demo.cadence.local'],
        members: ['Bassam Adel', 'Mina Samir', 'Yasmine Hamdy', 'Karim Fathy'],
        services: ['storefront-api', 'catalog'],
      },
      {
        em: ['Rana Abdelaziz', 'rana@demo.cadence.local'],
        members: ['Omar Elshamy', 'Mariam Ashraf', 'Kirollos Nabil'],
        services: ['checkout-web'],
      },
    ],
  },
  {
    lead: ['Hoda Khaled', 'hoda@demo.cadence.local'],
    tribe: 'Growth',
    teams: [
      {
        em: ['Sherif Ayad', 'sherif@demo.cadence.local'],
        members: ['Mahmoud Saeed', 'Christine Wagih', 'Tamer Galal', 'Nada Mansour'],
        services: ['growth-api', 'experiments'],
      },
      {
        em: ['Dina Fouad', 'dina@demo.cadence.local'],
        members: ['Mohamed Ragab', 'Andrew Samy', 'Salma Ibrahim'],
        services: ['marketing-site'],
      },
    ],
  },
];

/**
 * Deletes previous demo data (connections whose name starts with "Demo", demo tribe leads and engineering
 * managers, and their members), then recreates it. Demo accounts end in `@demo.cadence.local`; ones left over
 * from older seeds end in `@demo.cadence` and are removed too. Tribe leads report to the existing admin,
 * if any.
 */
async function main() {
  const passwordHash = await bcrypt.hash('demo-password-123', 10);
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  await prisma.integrationConnection.deleteMany({ where: { name: { startsWith: 'Demo' } } });
  const demoEmail = { OR: DEMO_EMAIL_SUFFIXES.map((endsWith) => ({ email: { endsWith } })) };
  await prisma.member.deleteMany({ where: { manager: demoEmail } });
  await prisma.user.deleteMany({ where: { role: 'ENGINEERING_MANAGER', ...demoEmail } });
  await prisma.user.deleteMany({ where: { role: 'TRIBE_LEAD', ...demoEmail } });

  // Code activity + deployments come from Azure DevOps, work items from Jira (disabled: never synced).
  const ado = await prisma.integrationConnection.create({
    data: {
      name: 'Demo · Azure DevOps',
      provider: 'AZURE_DEVOPS',
      baseUrl: 'https://dev.azure.com/demo',
      encryptedSecret: 'demo',
      enabled: false,
      features: ['SOURCE_CONTROL', 'DEPLOYMENTS'],
      config: { projects: ['Retail', 'Growth'] },
    },
  });
  const jira = await prisma.integrationConnection.create({
    data: {
      name: 'Demo · Jira',
      provider: 'JIRA',
      baseUrl: 'https://demo.atlassian.net',
      encryptedSecret: 'demo',
      enabled: false,
      features: ['WORK_TRACKING'],
      config: { deployment: 'cloud', storyPointsField: 'customfield_10016' },
    },
  });
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();

  for (const tribe of ORG) {
    const lead = await prisma.user.create({
      data: {
        name: tribe.lead[0],
        email: tribe.lead[1],
        role: 'TRIBE_LEAD',
        tribeName: tribe.tribe,
        passwordHash,
        reportsToId: admin?.id,
      },
    });
    for (const team of tribe.teams) {
      const em = await prisma.user.create({
        data: { name: team.em[0], email: team.em[1], role: 'ENGINEERING_MANAGER', passwordHash, reportsToId: lead.id },
      });
      for (const name of team.members) {
        const member = await prisma.member.create({
          data: {
            name,
            title: pick(0, 3) ? 'Software Engineer' : 'Senior Engineer',
            managerId: em.id,
            email: `${name.split(' ')[0].toLowerCase()}@demo.cadence.local`,
          },
        });
        const first = name.split(' ')[0].toLowerCase();
        await prisma.externalIdentity.createMany({
          data: [
            { memberId: member.id, connectionId: ado.id, username: `${first}@demo.cadence.local` },
            { memberId: member.id, connectionId: jira.id, username: `acc-${first}` },
          ],
        });
        const pace = 0.6 + rand() * 0.8;
        const rows = [];
        const items: { key: string; date: Date; storyPoints: number; cycleTimeHours: number; memberId: string }[] = [];
        for (let d = 59; d >= 0; d--) {
          const date = new Date(today - d * DAY);
          if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
          const issues = rand() < 0.45 * pace ? pick(1, 2) : 0;
          const done = Array.from({ length: issues }, () => ({ points: pick(1, 5), cycle: 12 + rand() * 90 }));
          for (const [n, item] of done.entries()) {
            items.push({
              key: `DEMO-${first}-${d}-${n}`,
              date,
              storyPoints: item.points,
              cycleTimeHours: item.cycle,
              memberId: member.id,
            });
          }
          rows.push({
            memberId: member.id,
            connectionId: ado.id,
            date,
            commits: Math.round(pick(0, 6) * pace),
            prsRaised: rand() < 0.35 * pace ? 1 : 0,
            prsMerged: rand() < 0.3 * pace ? 1 : 0,
            prsReviewed: Math.round(pick(0, 3) * pace),
          });
          rows.push({
            memberId: member.id,
            connectionId: jira.id,
            date,
            issuesCompleted: issues,
            storyPoints: done.reduce((n, i) => n + i.points, 0),
            cycleTimeHoursSum: done.reduce((n, i) => n + i.cycle, 0),
            cycleTimeSamples: issues,
          });
        }
        await prisma.dailyMetric.createMany({ data: rows });
        // One reviewed PR per PR raised, first reviewed on the day it was raised or the next; some teams wait longer.
        const teamMean = 3 + (team.em[0].length % 4) * 2;
        await prisma.reviewedPullRequest.createMany({
          data: rows
            .filter((r) => r.connectionId === ado.id && r.prsRaised)
            .map((r, n) => {
              const waitHours = Math.round(reviewWait(teamMean) * 100) / 100;
              const reviewed = Math.min(today, r.date.getTime() + Math.floor(waitHours / 24) * DAY);
              return {
                connectionId: ado.id,
                key: `DEMO-PR-${first}-${n}`,
                memberId: member.id,
                date: new Date(reviewed),
                waitHours,
              };
            }),
        });
        for (const { memberId, ...item } of items) {
          await prisma.workItem.create({
            data: { ...item, connectionId: jira.id, contributors: { create: { memberId } } },
          });
        }
      }
      for (const svc of team.services) {
        const service = await prisma.deliveryService.create({
          data: { connectionId: ado.id, name: `${tribe.tribe}/${svc}-deploy`, managerId: em.id },
        });
        const deploys = [];
        let id = 0;
        for (let d = 59; d >= 0; d--) {
          const day = today - d * DAY;
          if (new Date(day).getUTCDay() % 6 === 0) continue;
          for (let n = 0; n < pick(0, 2); n++) {
            const failed = rand() < 0.12;
            deploys.push({
              serviceId: service.id,
              externalId: String(++id),
              environment: 'production',
              status: failed ? ('FAILED' as const) : ('SUCCESS' as const),
              finishedAt: new Date(day + pick(9, 17) * 36e5),
              leadTimeHours: failed ? null : 2 + rand() * 60,
            });
          }
        }
        await prisma.deployment.createMany({ data: deploys });
      }
    }
  }
  console.log('Demo data ready. Demo logins use password "demo-password-123", e.g. ahmed@demo.cadence.local');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
