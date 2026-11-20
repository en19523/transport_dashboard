import api, { route } from '@forge/api';
import type { LinkEntry, Report, ReportIssue } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const HEADERS = ['Jira', 'Description', 'Owner', 'Dependencies', 'Transport Yes/no', 'Notes'];

const text = (t: string, marks?: Node[]): Node => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const link = (t: string, href: string): Node => text(t, [{ type: 'link', attrs: { href } }]);
const para = (content: Node[]): Node => ({ type: 'paragraph', content });

function dependencyCell(issue: ReportIssue): Node[] {
  const hasBlockers = issue.blockers.length > 0;
  const entries: LinkEntry[] = hasBlockers ? issue.blockers : issue.info;
  if (entries.length === 0) return [para([])];

  const inline: Node[] = [];
  if (hasBlockers) inline.push(text('BLOCKER: ', [{ type: 'strong' }, { type: 'textColor', attrs: { color: '#BF2600' } }]));
  entries.forEach((e, i) => {
    if (i > 0) inline.push(text(' • '));
    inline.push(text(`${e.phrase} `), link(e.key, e.url), text(` [${e.status}]`));
  });
  return [para(inline)];
}

const cellKey = (cell: Node): string => {
  let out = '';
  const walk = (n: Node) => {
    if (n?.type === 'text') out += n.text;
    (n?.content ?? []).forEach(walk);
  };
  walk(cell);
  return out.trim();
};

const isEmptyCell = (content: Node[] | undefined) => !content || content.every((n) => !n.content || n.content.length === 0);

/** Reads transport/notes cells that were already filled in from a previous report. */
function readOldEntries(table: Node | undefined): Map<string, { ship: Node[]; note: Node[] }> {
  const map = new Map<string, { ship: Node[]; note: Node[] }>();
  for (const row of table?.content ?? []) {
    const cells: Node[] = row.content ?? [];
    if (row.content?.[0]?.type === 'tableHeader' || cells.length < 6) continue;
    const key = cellKey(cells[0]);
    if (!key) continue;
    map.set(key, { ship: cells[4].content ?? [], note: cells[5].content ?? [] });
  }
  return map;
}

function buildTable(report: Report, tableId: string, old: Map<string, { ship: Node[]; note: Node[] }>): Node {
  const header: Node = {
    type: 'tableRow',
    content: HEADERS.map((h) => ({
      type: 'tableHeader',
      attrs: {},
      content: [para([text(h, [{ type: 'strong' }])])],
    })),
  };

  const rows: Node[] = report.issues.map((issue) => {
    const prev = old.get(issue.key);
    const cell = (content: Node[]): Node => ({ type: 'tableCell', attrs: {}, content });
    return {
      type: 'tableRow',
      content: [
        cell([para([link(issue.key, issue.url)])]),
        cell([para([link(issue.summary || issue.key, issue.url)])]),
        cell([para([text(issue.assignee)])]),
        cell(dependencyCell(issue)),
        cell(isEmptyCell(prev?.ship) ? [para([])] : prev!.ship),
        cell(isEmptyCell(prev?.note) ? [para([])] : prev!.note),
      ],
    };
  });

  return { type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default', localId: tableId }, content: [header, ...rows] };
}

/** Recursively finds the container (array) that holds the macro. */
function findMacro(nodes: Node[], localId: string): { parent: Node[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const id = n?.attrs?.localId ?? n?.attrs?.parameters?.localId;
    if (id === localId && /extension/i.test(n.type)) return { parent: nodes, index: i };
    if (Array.isArray(n?.content)) {
      const hit = findMacro(n.content, localId);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Writes the report directly after the macro on the page. A previous report
 * of this macro is replaced, the notes/transport columns are preserved.
 */
export async function writeReportToPage(pageId: string, macroLocalId: string, report: Report, userName: string): Promise<void> {
  const getRes = await api
    .asUser()
    .requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`, {
      headers: { Accept: 'application/json' },
    });
  if (!getRes.ok) throw new Error(`Seite konnte nicht gelesen werden (HTTP ${getRes.status}).`);
  const page: any = await getRes.json();

  const doc: Node = JSON.parse(page.body.atlas_doc_format.value);
  doc.content = doc.content ?? [];

  const infoId = `didi-info-${macroLocalId}`;
  const tableId = `didi-table-${macroLocalId}`;

  const found = findMacro(doc.content, macroLocalId);
  const container: Node[] = found ? found.parent : doc.content;
  let insertAt = found ? found.index + 1 : container.length;

  // Remove earlier reports of this macro, but remember their entries.
  let oldTable: Node | undefined;
  for (let i = container.length - 1; i >= 0; i--) {
    const id = container[i]?.attrs?.localId;
    if (id === tableId) oldTable = container[i];
    if (id === tableId || id === infoId) {
      container.splice(i, 1);
      if (i < insertAt) insertAt--;
    }
  }

  const info = {
    type: 'paragraph',
    attrs: { localId: infoId },
    content: [
      text(
        `${report.count} Ticket(s) in "Ready for deployment" | Projekt ${report.project} | erstellt ${report.generatedAt} von ${userName}`,
        [{ type: 'em' }],
      ),
    ],
  };
  const table = buildTable(report, tableId, readOldEntries(oldTable));
  container.splice(insertAt, 0, info, table);

  const putRes = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: pageId,
      status: 'current',
      title: page.title,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(doc) },
      version: { number: page.version.number + 1, message: 'DIDI Transport-Bericht aktualisiert' },
    }),
  });
  if (!putRes.ok) {
    const detail = await putRes.text();
    throw new Error(`Seite konnte nicht gespeichert werden (HTTP ${putRes.status}): ${detail.slice(0, 200)}`);
  }
}
