import type { Backend, Profile } from "./data";
import { LoadState, RpcForm, Timeline, text, useRpc, type Row } from "./workflow-ui";
export default function DocumentHistory({ backend, profile, id, onChanged, onClose }: { backend: Backend; profile: Profile; id: string; onChanged: () => void; onClose: () => void }) {
  const detail = useRpc<{ document: Row; timeline: Row[] }>(backend, "document_detail", { p_id: id });
  const refresh = () => { detail.reload(); onChanged(); };
  return <aside className="form-panel workflow-stack" aria-label="Document details">
    <button onClick={onClose}>Close document details</button><LoadState {...detail} />
    {detail.data && <><h3>{text(detail.data.document.doc_no)}</h3><p>{text(detail.data.document.title)}</p><p>{text(detail.data.document.excerpt)}</p>
      {detail.data.document.status === "in_review" && !!detail.data.document.can_release && <RpcForm backend={backend} profile={profile} name="return_document" title="Request changes" initialKey={id} fields={[{ name: "p_reason", label: "Changes needed", type: "textarea", required: true }]} build={v => ({ p_id: id, ...v })} onSaved={refresh} submit="Return for changes" />}
      {detail.data.document.status === "released" && <RpcForm backend={backend} profile={profile} name="acknowledge_document" title="Acknowledge this revision" initialKey={id} fields={[{ name: "p_name", label: "Your typed name", required: true }]} build={v => ({ p_id: id, ...v })} onSaved={refresh} submit="Record acknowledgement"><p className="muted">Records your name and the acknowledgement time against this revision.</p></RpcForm>}
      <Timeline events={detail.data.timeline} />
    </>}
  </aside>;
}
