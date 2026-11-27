const paths: Record<string, string> = {
  inbox: "M4 5h16v14H4z M4 12h4l2 3h4l2-3h4",
  projects: "M3 7h7l2-3h9v16H3z M7 11h10 M7 15h6",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3 20v-2a6 6 0 0 1 12 0v2 M16 5a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 4v2",
  documents: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  finance: "M5 3h14v18l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h5 M8 15h8",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.8.4l-.1.1h-3.2l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.8-1.6.1-.2a1.7 1.7 0 0 0-.4-1.8l-.1-.1v-3.2l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.6-2.8.2.1a1.7 1.7 0 0 0 1.8-.4l.1-.1h3.2l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.8 1.6-.1.2a1.7 1.7 0 0 0 .4 1.8l.1.1z",
  capture: "M5 5h4l1-2h4l1 2h4v16H5z M9 13l2 2 4-5 M9 5v3h6V5",
  help: "M4 13v-2a8 8 0 0 1 16 0v2 M4 11H2v7h4v-7z M20 11h2v7h-4v-7z M20 18v3h-6",
  admin: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2",
  add: "M5 5h14v14H5z M8 12h8 M12 8v8",
  sync: "M5 9a8 8 0 0 1 13-4l2 2 M20 3v4h-4 M19 15a8 8 0 0 1-13 4l-2-2 M4 21v-4h4",
};
export function WorkspaceIcon({ name }: { name: string }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name] || paths.documents} /></svg>;
}
export function RevisionOutline() {
  return <svg className="revision-outline" viewBox="0 0 240 52" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M17 9C10 4 2 11 6 20C-1 26 4 37 12 36C13 46 26 49 33 43C40 49 52 48 57 43C65 49 77 49 83 43C91 48 103 49 110 43C119 49 132 48 138 43C147 49 160 49 166 43C175 49 186 48 193 43C203 49 215 47 219 41C231 44 238 36 232 29C241 23 237 11 227 12C223 3 210 3 203 8C196 2 183 3 178 8C170 2 157 3 151 8C143 2 130 3 124 8C116 2 103 3 97 8C89 2 76 3 70 8C62 2 49 3 43 8C34 2 22 3 17 9Z" fill="none" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
  </svg>;
}
export function SidebarDrafting() {
  return <svg className="rail-drafting" viewBox="0 0 252 900" preserveAspectRatio="none" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="0.65">
    <path d="M17 14v872M235 14v872M10 24h232M10 876h232 M12 100h10M230 100h10M12 800h10M230 800h10" />
    <path d="M35 18v12M29 24h12M211 18v12M205 24h12M35 870v12M29 876h12M211 870v12M205 876h12" />
    <circle cx="78" cy="24" r="3" /><circle cx="174" cy="24" r="3" />
  </svg>;
}
