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
  payload: {
    title: string;
    description?: string;
    starts?: string;
    ends?: string;
  };
  status: string;
  current_step: number;
  steps: number;
  can_decide: boolean;
  waiting_on: string;
  created_at: string;
  orphaned?: boolean;
}
export interface RequestPage {
  items: RequestRow[];
  has_more: boolean;
  offset: number;
}
export interface RequestDetail {
  request: RequestRow & { can_withdraw: boolean };
  steps: {
    number: number;
    type: string;
    permission: string | null;
    status: string;
    decided_by: string | null;
    decided_at: string | null;
    comment: string | null;
  }[];
  timeline: {
    seq: number;
    at: string;
    actor: string;
    action: string;
    step: number | null;
    result: string | null;
    reason: string | null;
  }[];
}
export interface ApprovalAttention {
  orphaned_count: number;
  technical_only: boolean;
}
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
  can_manage?: boolean;
  can_release?: boolean;
  has_file?: boolean;
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
const previewDeployment = __XELRA_VERCEL_ENV__ === "preview";
const url = previewDeployment
  ? import.meta.env.VITE_PREVIEW_SUPABASE_URL
  : import.meta.env.VITE_SUPABASE_URL;
const key = previewDeployment
  ? import.meta.env.VITE_PREVIEW_SUPABASE_PUBLISHABLE_KEY
  : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
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
const profileImageBucket = "xelra-profile-images";
function profileImagePath(profileId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId))
    throw Error("A valid signed-in profile is required for profile images.");
  return `${profileId}/avatar.jpg`;
}
function requireSupabase() {
  if (!supabase) throw Error("Profile image storage is not configured.");
  return supabase;
}
export async function getProfileImageUrl(profileId: string): Promise<string | null> {
  const client = requireSupabase(), path = profileImagePath(profileId);
  const { data: files, error } = await client.storage.from(profileImageBucket).list(profileId, { limit: 1, search: "avatar.jpg" });
  if (error) throw Error(error.message);
  if (!files.some(file => file.name === "avatar.jpg")) return null;
  const { data, error: signedUrlError } = await client.storage.from(profileImageBucket).createSignedUrl(path, 60 * 60 * 24);
  if (signedUrlError) throw Error(signedUrlError.message);
  return data.signedUrl;
}
export async function uploadProfileImage(profileId: string, image: Blob): Promise<string> {
  if (image.type !== "image/jpeg" || image.size === 0 || image.size > 256 * 1024)
    throw Error("Profile photos must be prepared as JPEG images up to 256 KB.");
  const client = requireSupabase(), path = profileImagePath(profileId);
  const { error } = await client.storage.from(profileImageBucket).upload(path, image, {
    cacheControl: "3600", contentType: "image/jpeg", upsert: true,
  });
  if (error) throw Error(error.message);
  const url = await getProfileImageUrl(profileId);
  if (!url) throw Error("The uploaded profile photo could not be verified.");
  return url;
}
export async function removeProfileImage(profileId: string): Promise<void> {
  const client = requireSupabase(), path = profileImagePath(profileId);
  const { error } = await client.storage.from(profileImageBucket).remove([path]);
  if (error) throw Error(error.message);
}
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
        .select("id,doc_no,title,division,project,revision,status,can_manage,can_release,has_file")
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
      documents: (await checked(documents)) as DocumentRow[],
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
