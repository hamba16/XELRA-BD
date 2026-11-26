// The command palette is built from one registry. A command exists for a person only if the same
// permission the database checks says so. Nothing here grants access; it only avoids showing dead ends.
export interface Command {
  id: string; label: string; hint?: string; keywords?: string[];
  needs?: string;                       // permission code, e.g. 'leave.approve'
  group: 'Go to' | 'Create' | 'Find' | 'Admin';
  run: (nav: (path: string) => void) => void;
}
export const registry: Command[] = [
  { id: 'go.inbox',   group: 'Go to',  label: 'Inbox',                 hint: 'g i', keywords: ['approvals', 'tasks'], run: n => n('/inbox') },
  { id: 'go.people',  group: 'Go to',  label: 'People',                hint: 'g p', needs: 'people.read', run: n => n('/people') },
  { id: 'new.leave',  group: 'Create', label: 'Request leave',         hint: 'n l', keywords: ['holiday', 'off'], run: n => n('/leave/new') },
  { id: 'new.expense',group: 'Create', label: 'Claim an expense',      hint: 'n e', keywords: ['receipt', 'reimburse'], run: n => n('/expenses/new') },
  { id: 'new.ticket', group: 'Create', label: 'Ask IT for help',       hint: 'n t', keywords: ['helpdesk', 'bug', 'access'], run: n => n('/help/new') },
  { id: 'new.payrun', group: 'Create', label: 'Start a payroll run',   needs: 'payroll.prepare', run: n => n('/payroll/runs/new') },
  { id: 'find.doc',   group: 'Find',   label: 'Find a document by number', keywords: ['DRN', 'drawing', 'report'], run: n => n('/documents?focus=search') },
  { id: 'adm.users',  group: 'Admin',  label: 'Create a profile',      needs: 'users.create', run: n => n('/admin/users/new') },
];
export const visible = (cmds: Command[], can: (perm: string) => boolean) => cmds.filter(c => !c.needs || can(c.needs));

/** Small, dependency-free ranking: prefix beats word-start beats substring beats keyword. */
export function rank(cmds: Command[], q: string): Command[] {
  const s = q.trim().toLowerCase();
  if (!s) return cmds;
  const score = (c: Command) => {
    const l = c.label.toLowerCase();
    if (l.startsWith(s)) return 4;
    if (l.split(' ').some(w => w.startsWith(s))) return 3;
    if (l.includes(s)) return 2;
    if (c.keywords?.some(k => k.toLowerCase().includes(s))) return 1;
    return 0;
  };
  return cmds.map(c => [c, score(c)] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
