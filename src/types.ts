export interface ReportConfig {
    project: string;
    okStatuses: string;
    depPhrases: string;
    assignees: string;
    /** Checkbox group in the macro dialog: ['yes'] = only tickets with blockers. */
    onlyBlockers?: string[];
}

export const DEFAULT_CONFIG: ReportConfig = {
    project: 'HMFOCUS',
    okStatuses: 'Ready for deployment,Fertig,Done,Closed,Resolved,Geschlossen',
    depPhrases:
      'depends on,is blocked by,requires,needs,must be done after,prerequisite,precondition,blocks,blocked,waiting on,predecessor',
    assignees: '',
};

export interface LinkEntry {
    phrase: string;
    key: string;
    status: string;
    url: string;
}

export interface ReportIssue {
    key: string;
    url: string;
    summary: string;
    assignee: string;
    status: string;
    blockers: LinkEntry[];
    info: LinkEntry[];
}

export interface Report {
    project: string;
    generatedAt: string;
    count: number;
    issues: ReportIssue[];
}

/** Manual entries per ticket, stored per macro instance. */
export interface Entry {
    ship: string;
    note: string;
}
export type Entries = Record<string, Entry>;
