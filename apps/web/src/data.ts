import { createClient } from "@supabase/supabase-js";
export type Division = "ENG" | "AMG" | "COR";
export interface Profile {
  id: string;
  name: string;
  principal: string;
  permissions: string[];
  divisions: Division[];
}
export interface RequestRow {
  id: string;
  kind: string;
  division: Division;
  requester: string;
  requester_name: string;
  amount_ugx?: number;
  payload: { title: string; description?: string; starts?: string; ends?: string };
  status: string;
  current_step: number;
  steps: number;
  can_decide: boolean;
  waiting_on: string;
  created_at: string;
  orphaned?: boolean;
}
export interface RequestPage { items: RequestRow[]; has_more: boolean; offset: number }
export interface RequestDetail {
  request: RequestRow & { can_withdraw: boolean };
  steps: { number: number; type: string; permission: string | null; status: string; decided_by: string | null; decided_at: string | null; comment: string | null }[];
  timeline: { seq: number; at: string; actor: string; action: string; step: number | null; result: string | null; reason: string | null }[];
}
export interface ApprovalAttention { orphaned_count: number; technical_only: boolean }
export interface Project {
  code: string;
  title: string;
  division: Division;
  budget_ugx: number;
  actual_ugx: number;
  progress: number;
}
export interface DocumentRow {
  id: string;
  doc_no: string;
  title: string;
  division: Division;
  project: string;
  revision: number;
  status: string;
}
export interface RecordRow {
  id: string;
  module: string;
  title: string;
  division: Division;
  status: string;
  data: { description?: string };
  expires_on?: string;
}
export interface Snapshot {
  profile: Profile;
  requests: RequestRow[];
  projects: Project[];
  documents: DocumentRow[];
  people: {
    id: string;
    full_name: string;
    principal: string;
    status: string;
  }[];
  records: RecordRow[];
}
export interface Backend {
  load(): Promise<Snapshot>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  signOut(): Promise<void>;
}
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && !url.includes("PROJECT_REF"));
export const supabase = configured
  ? createClient(url, key, {
      db: { schema: "api" },
      auth: {
        persistSession: true,
        storage: sessionStorage,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
async function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): Promise<NonNullable<T>> {
  if (result.error) throw Error(result.error.message);
  if (result.data == null)
    throw Error(
      "Your account has no active XELRA profile. Contact your administrator.",
    );
  return result.data as NonNullable<T>;
}
export const live: Backend = {
  async load() {
    const profile = (await checked(await supabase!.rpc("profile"))) as Profile;
    const [requests, projects, documents, people, records] = await Promise.all([
      supabase!.rpc("inbox"),
      supabase!
        .from("projects")
        .select("code,title,division,budget_ugx,actual_ugx,progress")
        .order("code")
        .limit(50),
      supabase!
        .from("documents")
        .select("id,doc_no,title,division,project,revision,status")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase!
        .from("people")
        .select("id,full_name,principal,status")
        .order("full_name")
        .limit(50),
      supabase!
        .from("records")
        .select("id,module,title,division,status,data,expires_on")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      profile,
      requests: await checked(requests),
      projects: await checked(projects),
      documents: await checked(documents),
      people: await checked(people),
      records: await checked(records),
    };
  },
  async rpc(name, args) {
    return checked(await supabase!.rpc(name, args));
  },
  async signOut() {
    const { error } = await supabase!.auth.signOut();
    if (error) throw error;
  },
};
export async function downloadFile(id: string) {
  const origin = import.meta.env.VITE_FILES_ORIGIN;
  if (!origin || !supabase)
    throw Error("Document delivery has not been configured.");
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${origin}/files/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
    cache: "no-store",
  });
  if (!response.ok)
    throw Error(
      "This file could not be downloaded. Your access may have changed.",
    );
  const href = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = "xelra-document";
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
