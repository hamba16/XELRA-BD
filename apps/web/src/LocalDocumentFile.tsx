import { useState } from "react";
import type { Backend, DocumentRow, Profile } from "./data";
import { LocalFileStore, downloadLocal } from "./local-files";

export default function LocalDocumentFile({ backend, profile, document, onSaved }: { backend: Backend; profile: Profile; document: DocumentRow; onSaved: () => void }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const store = new LocalFileStore(profile.id);
  return <div className="workflow-stack">
    {document.status === "draft" && <label>Local file for {document.doc_no}<input type="file" disabled={busy} accept=".pdf,.docx,.xlsx,.pptx,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.csv,.zip" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError("");
      try {
        const stored = await store.put(document.id, file);
        await backend.rpc("attach_document", { p_id: document.id, p_object_key: `documents/local/${encodeURIComponent(profile.id)}/${document.id}/${encodeURIComponent(stored.name)}`, p_sha256: stored.sha256 });
        onSaved();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} /></label>}
    {document.has_file && <button onClick={async () => { try { const file = await store.get(document.id); if (!file) throw Error("This file is not saved in this browser profile."); downloadLocal(file); } catch (e) { setError((e as Error).message); } }}>Download local file</button>}
    {busy && <span role="status">Saving and verifying file…</span>}{error && <span role="alert" className="error">{error}</span>}
  </div>;
}
