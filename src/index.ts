import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { buildReport } from './report';
import { writeReportToPage } from './page';
import type { ReportConfig } from './types';

const resolver = new Resolver();

/** Fetches the report from Jira and writes it directly into the page that hosts the macro. */
resolver.define('createReport', async ({ payload, context }) => {
  const ctx = context as any;
  const pageId: string | undefined = ctx.extension?.content?.id;
  const localId: string | undefined = ctx.localId;
  if (!pageId || !localId) throw new Error('Seite oder Makro konnte nicht ermittelt werden.');

  const siteUrl = String(ctx.siteUrl ?? '').replace(/\/$/, '');
  const report = await buildReport((payload ?? {}) as Partial<ReportConfig>, siteUrl);

  let userName = 'unbekannt';
  const me = await api.asUser().requestJira(route`/rest/api/3/myself`);
  if (me.ok) userName = ((await me.json()) as { displayName?: string }).displayName ?? userName;

  await writeReportToPage(pageId, localId, report, userName);
  return { count: report.count, project: report.project };
});

export const handler = resolver.getDefinitions();
