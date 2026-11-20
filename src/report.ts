import api, { route } from '@forge/api';
import { DEFAULT_CONFIG, LinkEntry, Report, ReportConfig, ReportIssue } from './types';

const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** If the list is empty, the default value applies. */
const listOrDefault = (raw: string | undefined, fallback: string): string[] => {
  const list = splitList(raw ?? '');
  return list.length > 0 ? list : splitList(fallback);
};

/** JQL string literal with escaped backslashes and double quotes. */
const jqlQuote = (value: string): string => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

interface JiraLink {
  type?: { inward?: string; outward?: string };
  inwardIssue?: JiraLinkedIssue;
  outwardIssue?: JiraLinkedIssue;
}
interface JiraLinkedIssue {
  key?: string;
  fields?: { status?: { name?: string } };
}
interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    assignee?: { displayName?: string } | null;
    status?: { name?: string };
    issuelinks?: JiraLink[];
  };
}
interface SearchResponse {
  issues?: JiraIssue[];
  nextPageToken?: string;
  errorMessages?: string[];
}

/**
 * Classifies the issue links of a ticket into "blockers" (hard, unfinished
 * dependencies) and "info" (everything else, e.g. "relates to").
 */
function classifyLinks(
  issue: JiraIssue,
  siteUrl: string,
  okStatuses: string[],
  depPhrases: string[],
): { blockers: LinkEntry[]; info: LinkEntry[] } {
  const blockers: LinkEntry[] = [];
  const info: LinkEntry[] = [];

  for (const link of issue.fields.issuelinks ?? []) {
    let phrase: string;
    let other: JiraLinkedIssue;
    if (link.outwardIssue) {
      phrase = link.type?.outward ?? 'verlinkt mit';
      other = link.outwardIssue;
    } else if (link.inwardIssue) {
      phrase = link.type?.inward ?? 'verlinkt mit';
      other = link.inwardIssue;
    } else {
      continue;
    }

    // Duplicates are irrelevant for the transport check.
    if (phrase.toLowerCase().includes('duplicate')) continue;

    const key = other.key ?? '?';
    const status = other.fields?.status?.name ?? 'Unbekannt';
    const lower = phrase.toLowerCase();
    const isDependency = depPhrases.some((p) => lower.includes(p.toLowerCase()));

    const entry: LinkEntry = { phrase, key, status, url: `${siteUrl}/browse/${key}` };
    if (isDependency && !okStatuses.includes(status)) {
      blockers.push(entry);
    } else {
      info.push(entry);
    }
  }
  return { blockers, info };
}

async function searchIssues(jql: string): Promise<JiraIssue[]> {
  const fields = 'summary,assignee,status,issuelinks';
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  do {
    const res = nextPageToken
      ? await api
          .asUser()
          .requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&nextPageToken=${nextPageToken}`,
          )
      : await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`);

    const data = (await res.json()) as SearchResponse;
    if (!res.ok) {
      throw new Error(`Jira-Fehler: ${data.errorMessages?.[0] ?? `HTTP ${res.status}`}`);
    }
    const page = data.issues ?? [];
    issues.push(...page);
    nextPageToken = page.length > 0 ? data.nextPageToken : undefined;
  } while (nextPageToken);

  return issues;
}

export async function buildReport(config: Partial<ReportConfig>, siteUrl: string): Promise<Report> {
  const project = (config.project ?? DEFAULT_CONFIG.project).replace(/[^A-Za-z0-9_]/g, '').toUpperCase();
  if (project === '') throw new Error('Ungueltiger Projekt-Key.');

  const okStatuses = listOrDefault(config.okStatuses, DEFAULT_CONFIG.okStatuses);
  const depPhrases = listOrDefault(config.depPhrases, DEFAULT_CONFIG.depPhrases);
  const assignees = splitList(config.assignees ?? '');

  let jql = `project = ${project} AND status = "Ready for deployment"`;
  if (assignees.length > 0) {
    jql += ` AND assignee in (${assignees.map(jqlQuote).join(', ')})`;
  }
  jql += ' ORDER BY key ASC';

  const issues = await searchIssues(jql);

  const onlyBlockers = (config.onlyBlockers ?? []).includes('yes');

  const all: ReportIssue[] = issues.map((issue) => {
    const { blockers, info } = classifyLinks(issue, siteUrl, okStatuses, depPhrases);
    return {
      key: issue.key,
      url: `${siteUrl}/browse/${issue.key}`,
      summary: issue.fields.summary ?? '',
      assignee: issue.fields.assignee?.displayName ?? 'Nicht zugewiesen',
      status: issue.fields.status?.name ?? '-',
      blockers,
      info,
    };
  });

  const out = onlyBlockers ? all.filter((i) => i.blockers.length > 0) : all;

  return {
    project,
    generatedAt: new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich' }),
    count: out.length,
    issues: out,
  };
}
