// Never imported in a production build. Synthetic, in-memory walkthrough only.
import type {
  Backend,
  Snapshot,
  Division,
  Profile,
  RequestDetail,
} from "../data";
export const marker = "__XELRA_DEV_SWITCHER__";
const defaultProfile: Profile = {
  id: "preview-director",
  name: "Sample Director",
  principal: "staff",
  permissions: [
    "view.combined",
    "projects.read",
    "documents.read",
    "documents.create",
    "documents.manage",
    "documents.release",
    "people.read",
    "records.read",
    "records.create",
    "approvals.read",
    "payroll.read",
    "expense.depthead",
  ],
  divisions: ["ENG", "AMG"],
};
const sampleProjects = [
  {
    code: "P014",
    title: "Kampala infrastructure survey",
    division: "ENG" as Division,
    budget_ugx: 24000000,
    actual_ugx: 8500000,
    progress: 40,
  },
  {
    code: "P022",
    title: "Lakeside property assessment",
    division: "AMG" as Division,
    budget_ugx: 12000000,
    actual_ugx: 4000000,
    progress: 50,
  },
];

export function createPreview(profile: Profile): Backend {
  const canDecide = profile.permissions.some((p) =>
    [
      "expense.approve.central",
      "expense.depthead",
      "expense.approve.fm",
      "generic.approve",
    ].includes(p),
  );
  const state: Snapshot = {
    profile,
    requests: profile.permissions.includes("approvals.read")
      ? [
          {
            id: "sample-expense",
            kind: "expense",
            division: "ENG",
            requester: "sample-engineer",
            requester_name: "Sample Engineer",
            amount_ugx: 6500000,
            payload: { title: "Roofing materials · P014" },
            status: "pending",
            current_step: 2,
            steps: 2,
            can_decide: canDecide,
            waiting_on: canDecide
              ? profile.name
              : "Another authorised approver",
            created_at: "2026-11-25T09:00:00Z",
          },
        ]
      : [],
    projects: profile.permissions.includes("projects.read")
      ? sampleProjects.filter(
          (p) =>
            profile.permissions.includes("view.combined") ||
            profile.divisions.includes(p.division),
        )
      : [],
    documents: profile.permissions.includes("documents.read")
      ? [
          {
            id: "sample-document",
            doc_no: "DRN-ENG-P014-RPT-0001-R00",
            title: "Kampala survey report",
            division: "ENG",
            project: "P014",
            revision: 0,
            status: "draft",
            can_manage: profile.permissions.includes("documents.manage"),
            can_release: profile.permissions.includes("documents.release"),
            has_file: false,
          },
        ]
      : [],
    people: [
      {
        id: profile.id,
        full_name: profile.name,
        principal: profile.principal,
        status: "active",
      },
    ],
    records: [],
  };
  const details = new Map<string, Pick<RequestDetail, "steps" | "timeline">>();
  let sequence = 0;
  for (const request of state.requests)
    details.set(request.id, {
      steps: [
        {
          number: 1,
          type: "perm",
          permission: "expense.approve.fm",
          status: "approved",
          decided_by: "Sample Finance Manager",
          decided_at: request.created_at,
          comment: "Supplier quote reviewed.",
        },
        {
          number: 2,
          type: "perm",
          permission: "expense.approve.central",
          status: "waiting",
          decided_by: null,
          decided_at: null,
          comment: null,
        },
      ],
      timeline: [
        {
          seq: ++sequence,
          at: request.created_at,
          actor: request.requester_name,
          action: "approval.submit",
          step: null,
          result: null,
          reason: null,
        },
        {
          seq: ++sequence,
          at: request.created_at,
          actor: "Sample Finance Manager",
          action: "approval.decide",
          step: 1,
          result: "pending",
          reason: "Supplier quote reviewed.",
        },
      ],
    });
  const reports = new Map<string, string>();
  return {
    async load() {
      return structuredClone(state);
    },
    async signOut() {},
    async rpc(name, args) {
      if (name === "submit_request") {
        if (profile.principal !== "staff")
          throw Error(
            "Only staff profiles can submit requests in this walkthrough.",
          );
        const id = crypto.randomUUID();
        state.requests.unshift({
          id,
          kind: String(args.p_kind),
          division: args.p_division as Division,
          requester: profile.id,
          requester_name: profile.name,
          amount_ugx: Number(args.p_amount) || undefined,
          payload: args.p_payload as { title: string },
          status: "pending",
          current_step: 1,
          steps: 2,
          can_decide: false,
          waiting_on: "Another authorised approver",
          created_at: new Date().toISOString(),
          orphaned: true,
        });
        const request = state.requests[0];
        request.waiting_on = "Nobody currently available";
        details.set(id, {
          steps: [1, 2].map((number) => ({
            number,
            type: number === 1 ? "manager" : "perm",
            permission: number === 1 ? null : "leave.approve",
            status: "waiting",
            decided_by: null,
            decided_at: null,
            comment: null,
          })),
          timeline: [
            {
              seq: ++sequence,
              at: request.created_at,
              actor: profile.name,
              action: "approval.submit",
              step: null,
              result: null,
              reason: null,
            },
          ],
        });
        return id;
      }
      if (name === "decide_request") {
        const r = state.requests.find((r) => r.id === args.p_id);
        if (!r?.can_decide || r.status !== "pending")
          throw Error("Someone else needs to decide this request.");
        if (!args.p_approve && !String(args.p_comment || "").trim())
          throw Error("Tell the requester what to change.");
        r.status = args.p_approve ? "approved" : "rejected";
        r.can_decide = false;
        r.waiting_on = "Complete";
        r.orphaned = false;
        const d = details.get(r.id)!;
        const step = d.steps.find((s) => s.number === r.current_step)!;
        step.status = r.status;
        step.decided_by = profile.name;
        step.decided_at = new Date().toISOString();
        step.comment = args.p_comment ? String(args.p_comment) : null;
        d.timeline.push({
          seq: ++sequence,
          at: step.decided_at,
          actor: profile.name,
          action: "approval.decide",
          step: step.number,
          result: r.status,
          reason: step.comment,
        });
        return r.status;
      }
      if (name === "withdraw_request") {
        const r = state.requests.find((r) => r.id === args.p_id);
        if (!r || r.requester !== profile.id)
          throw Error("You cannot withdraw this request.");
        if (r.status !== "pending")
          throw Error("This request is no longer open.");
        r.status = "cancelled";
        r.can_decide = false;
        r.orphaned = false;
        r.waiting_on = "Complete";
        const d = details.get(r.id)!;
        for (const step of d.steps)
          if (step.status === "waiting") step.status = "skipped";
        d.timeline.push({
          seq: ++sequence,
          at: new Date().toISOString(),
          actor: profile.name,
          action: "approval.cancel",
          step: r.current_step,
          result: "cancelled",
          reason: args.p_reason ? String(args.p_reason) : null,
        });
        return r.status;
      }
      if (name === "request_page") {
        const rows = state.requests.filter(
          (r) =>
            (!args.p_division || r.division === args.p_division) &&
            (!args.p_status ||
              args.p_status === "all" ||
              r.status === args.p_status) &&
            (!args.p_view ||
              args.p_view === "all" ||
              (args.p_view === "mine" && r.requester === profile.id) ||
              (args.p_view === "waiting" && r.can_decide) ||
              (args.p_view === "stuck" &&
                r.orphaned &&
                r.status === "pending")),
        );
        const offset = Number(args.p_offset) || 0;
        return structuredClone({
          items: rows.slice(offset, offset + 50),
          has_more: rows.length > offset + 50,
          offset,
        });
      }
      if (name === "request_detail") {
        const r = state.requests.find((r) => r.id === args.p_id);
        if (!r) throw Error("This request is not available to you.");
        return structuredClone({
          request: {
            ...r,
            can_withdraw: r.requester === profile.id && r.status === "pending",
          },
          ...details.get(r.id),
        });
      }
      if (name === "approval_attention")
        return {
          orphaned_count: state.requests.filter(
            (r) =>
              r.orphaned &&
              r.status === "pending" &&
              (!args.p_division || r.division === args.p_division),
          ).length,
          technical_only: profile.permissions.includes("ops.read"),
        };
      if (
        [
          "attach_document",
          "submit_document",
          "release_document",
          "create_document_revision",
          "withdraw_document",
        ].includes(name)
      ) {
        const document = state.documents.find(
          (item) => item.id === args.p_id,
        );
        if (!document) throw Error("This document is not available.");
        if (name === "attach_document") {
          if (!profile.permissions.includes("documents.manage"))
            throw Error("You cannot attach a file to this document.");
          document.has_file = true;
          return "attached";
        }
        if (name === "submit_document") {
          if (document.status !== "draft" || !document.has_file)
            throw Error("Attach the file before submitting it.");
          document.status = "in_review";
          return "in_review";
        }
        if (name === "release_document") {
          if (!profile.permissions.includes("documents.release"))
            throw Error("You cannot release this document.");
          if (document.status !== "in_review")
            throw Error("Only documents in review can be released.");
          document.status = "released";
          return "released";
        }
        if (name === "create_document_revision") {
          if (!profile.permissions.includes("documents.manage"))
            throw Error("You cannot create revisions for this document.");
          if (document.status !== "released")
            throw Error("Only released documents can receive revisions.");
          document.status = "superseded";
          const revision = document.revision + 1;
          const revisionId = crypto.randomUUID();
          state.documents.unshift({
            id: revisionId,
            doc_no: document.doc_no.replace(
              /R\d{2}$/,
              `R${String(revision).padStart(2, "0")}`,
            ),
            title: args.p_title
              ? String(args.p_title)
              : document.title,
            division: document.division,
            project: document.project,
            revision,
            status: "draft",
            can_manage: true,
            can_release: profile.permissions.includes("documents.release"),
            has_file: false,
          });
          return revisionId;
        }
        if (document.status === "released")
          throw Error("Only draft or in-review documents can be withdrawn.");
        document.status = "withdrawn";
        return "withdrawn";
      }
      if (name === "create_document") {
        if (!profile.permissions.includes("documents.create"))
          throw Error("You cannot create documents in this walkthrough.");
        const id = crypto.randomUUID();
        const division = args.p_division as Division;
        const project = args.p_project ? String(args.p_project) : "CORP";
        state.documents.unshift({
          id,
          doc_no: `DRN-${division}-${project}-${String(args.p_type)}-${String(state.documents.length + 1).padStart(4, "0")}-R00`,
          title: String(args.p_title),
          division,
          project,
          revision: 0,
          status: "draft",
          can_manage: profile.permissions.includes("documents.manage"),
          can_release: profile.permissions.includes("documents.release"),
          has_file: false,
        });
        return id;
      }
      if (name === "create_record") {
        if (!profile.permissions.includes("records.create"))
          throw Error(
            "This profile cannot create register entries in the walkthrough.",
          );
        const id = crypto.randomUUID();
        state.records.unshift({
          id,
          module: String(args.p_module),
          title: String(args.p_title),
          division: args.p_division as Division,
          status: "active",
          data: args.p_data as { description: string },
        });
        return id;
      }
      if (name === "sync_field_report") {
        const id = String(args.p_client),
          value = JSON.stringify(args);
        if (reports.has(id) && reports.get(id) !== value)
          throw Error("Conflicting report.");
        const duplicate = reports.has(id);
        reports.set(id, value);
        return duplicate ? "duplicate" : "created";
      }
      if (name === "health" && profile.permissions.includes("ops.read"))
        return {
          backup_ok: true,
          keepalive_ok: true,
          restore_drill_ok: true,
          meters: [],
        };
      throw Error("This action is not available in the walkthrough.");
    },
  };
}

export const preview = createPreview(defaultProfile);
