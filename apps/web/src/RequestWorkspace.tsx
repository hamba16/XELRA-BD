import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ApprovalAttention, Backend, Division, RequestDetail, RequestPage, Snapshot } from './data';

const statuses = ['all','pending','approved','rejected','cancelled'];
const views = ['all','mine','waiting','stuck'];
const stateLabel = (s:string) => s==='rejected'?'Sent back':s==='cancelled'?'Withdrawn':s.charAt(0).toUpperCase()+s.slice(1);
const date = (s:string) => new Date(s).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});
const divisionNames = {ENG:'Engineering',AMG:'Asset Management',COR:'Corporate'};
const eventLabel = (action:string,result:string|null) => action==='approval.submit'?'Submitted request':action==='approval.cancel'?'Withdrew request':result==='rejected'?'Sent request back':'Approved step';

export function ApprovalHealth({backend}:{backend:Backend}){
 const [result,setResult]=useState<ApprovalAttention|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;backend.rpc('approval_attention',{}).then(r=>{if(active)setResult(r as ApprovalAttention);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[backend]);
 return <section className="queue-panel" aria-label="Approval routing health"><h2>Approval routing</h2>{error?<p role="alert">{error}</p>:result?<><p>{result.orphaned_count} open request{result.orphaned_count===1?'':'s'} without an eligible approver.</p><p className="muted">Ask the responsible Director to review manager assignments or cover. Business records are not included in this health check.</p></>:<p role="status">Checking approval routing…</p>}</section>;
}

export function RequestWorkspace({backend,data,division,onChanged}:{backend:Backend;data:Snapshot;division:Division|null;onChanged:()=>Promise<void>}){
 const storageKey=`xelra-request-view:${data.profile.id}:${division||'all'}`;
 const [filters,setFilters]=useState(()=>{try{const f=JSON.parse(localStorage.getItem(storageKey)||'{}');return{status:statuses.includes(f.status)?f.status:'all',view:views.includes(f.view)?f.view:'all'};}catch{return{status:'all',view:'all'};}});
 const [offset,setOffset]=useState(0),[page,setPage]=useState<RequestPage|null>(null),[listError,setListError]=useState(''),[loading,setLoading]=useState(true);
 const [attention,setAttention]=useState<ApprovalAttention|null>(null),[attentionError,setAttentionError]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<RequestDetail|null>(null),[detailError,setDetailError]=useState(''),[detailLoading,setDetailLoading]=useState(false);
 const [refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[action,setAction]=useState<'withdraw'|'reject'|null>(null),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
 const detailRef=useRef<HTMLElement>(null),reasonRef=useRef<HTMLTextAreaElement>(null),listRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(filters));}catch{/* preferences only; operations do not depend on storage */}},[filters,storageKey]);
 useEffect(()=>{
  let active=true;setLoading(true);setListError('');setPage(null);
  backend.rpc('request_page',{p_offset:offset,p_division:division,p_status:filters.status,p_view:filters.view}).then(r=>{if(active)setPage(r as RequestPage);}).catch(e=>{if(active)setListError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[backend,data,division,filters,offset,refresh]);
 useEffect(()=>{
  let active=true;setAttention(null);setAttentionError('');
  backend.rpc('approval_attention',{p_division:division}).then(r=>{if(active)setAttention(r as ApprovalAttention);}).catch(e=>{if(active)setAttentionError(e.message);});return()=>{active=false;};
 },[backend,data,division,refresh]);
 useEffect(()=>{
  let active=true;setDetail(null);setDetailError('');setAction(null);setReason('');
  if(!selected){setDetailLoading(false);return;}
  setDetailLoading(true);
  backend.rpc('request_detail',{p_id:selected}).then(r=>{if(active)setDetail(r as RequestDetail);}).catch(e=>{if(active)setDetailError(e.message);}).finally(()=>{if(active)setDetailLoading(false);});
  return()=>{active=false;};
 },[backend,data,selected,refresh]);
 useEffect(()=>{if(detail)detailRef.current?.focus();},[detail?.request.id]);
 useEffect(()=>{if(action)reasonRef.current?.focus();},[action]);
 function changeFilters(next:typeof filters){setFilters(next);setOffset(0);setSelected(null);}
 function select(id:string){setSelected(id);setNotice('');}
 async function decide(approve:boolean){
  if(!detail||busy||(!approve&&!reason.trim()))return;
  setBusy(true);setDetailError('');
  try{await backend.rpc('decide_request',{p_id:detail.request.id,p_approve:approve,p_comment:approve?null:reason.trim()});setNotice(approve?'Decision recorded.':'Sent back with your reason.');setAction(null);setRefresh(n=>n+1);await onChanged();}
  catch(e){setDetailError((e as Error).message);}
  finally{setBusy(false);}
 }
 async function withdraw(){
  if(!detail||busy)return;setBusy(true);setDetailError('');
  try{await backend.rpc('withdraw_request',{p_id:detail.request.id,p_reason:reason.trim()||null});setNotice('Request withdrawn. Completed steps remain in its history.');setAction(null);setRefresh(n=>n+1);await onChanged();}
  catch(e){setDetailError((e as Error).message);}
  finally{setBusy(false);}
 }
 function listKeys(e:KeyboardEvent){
  if(e.ctrlKey||e.metaKey||e.altKey||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
  if(!['j','k'].includes(e.key))return;const buttons=Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-request-row]')||[]);
  if(!buttons.length)return;const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
  e.preventDefault();buttons[(current+(e.key==='j'?1:-1)+buttons.length)%buttons.length].focus();
 }
 function detailKeys(e:KeyboardEvent){
  if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||action||busy||!detail?.request.can_decide)return;
  if(e.target instanceof HTMLElement&&(e.target.matches('input,textarea,select')||e.target.isContentEditable))return;
  if(e.key==='a'){e.preventDefault();void decide(true);}if(e.key==='s'){e.preventDefault();setAction('reject');}
 }
 return <section className="requests-workspace" aria-label="Request history and details">
  {attentionError&&<p role="alert">Approval routing could not be checked: {attentionError}</p>}
  {attention&&attention.orphaned_count>0&&<div className="notice routing-alert" role="status"><strong>{attention.orphaned_count} request{attention.orphaned_count===1?'':'s'} cannot move forward.</strong><p>Nobody is currently eligible to approve the next step. Ask the responsible Director to review the manager assignment or cover.</p>{!attention.technical_only&&<button onClick={()=>changeFilters({status:'pending',view:'stuck'})}>View stuck requests</button>}</div>}
  <div className="section-heading"><h2>Request history</h2><span className="muted">Filters are saved for your profile and division view.</span></div>
  <div className="request-filters"><label>Show requests<select value={filters.view} onChange={e=>changeFilters({...filters,view:e.target.value})}><option value="all">All accessible</option><option value="mine">My requests</option><option value="waiting">Waiting on me</option><option value="stuck">No eligible approver</option></select></label><label>Request status<select value={filters.status} onChange={e=>changeFilters({...filters,status:e.target.value})}>{statuses.map(s=><option key={s} value={s}>{s==='all'?'All statuses':stateLabel(s)}</option>)}</select></label><button disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh history</button></div>
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className={`request-split ${selected?'has-detail':''}`}>
   <div><div className="table-wrap" tabIndex={0} ref={listRef} role="region" aria-label="Request list; J and K move between requests, Enter opens one" onKeyDown={listKeys} aria-busy={loading}>
    {loading?<p className="request-state" role="status">Loading request history…</p>:listError?<div className="request-state"><p role="alert">{listError}</p><button onClick={()=>setRefresh(n=>n+1)}>Retry history</button></div>:<><table><thead><tr><th>Request</th><th>Division</th><th>Status</th><th>Next step</th></tr></thead><tbody>{page?.items.map(r=><tr key={r.id} data-selected={r.id===selected}><td><button data-request-row className="request-title" aria-label={`Open ${r.payload.title}`} onClick={()=>select(r.id)}>{r.payload.title}</button><small>{r.requester_name}</small></td><td>{divisionNames[r.division]}</td><td><span className={`status ${r.status==='approved'?'good':''}`}>{r.status==='approved'?'✓':'◷'} {stateLabel(r.status)}</span></td><td>{r.waiting_on}</td></tr>)}</tbody></table>{!page?.items.length&&<div className="empty"><h3>No requests match this view.</h3><p>Change the filters or create a request using the actions above.</p></div>}</>}
   </div><nav className="request-pagination" aria-label="Request history pages"><button disabled={offset===0||loading} onClick={()=>{setSelected(null);setOffset(n=>Math.max(0,n-50));}}>Previous page</button><span>Page {Math.floor(offset/50)+1}{page?.items.length?` · ${page.items.length} requests`:''}</span><button disabled={!page?.has_more||loading} onClick={()=>{setSelected(null);setOffset(n=>n+50);}}>Next page</button></nav></div>
   {selected&&<aside className="request-detail" ref={detailRef} tabIndex={-1} aria-label="Selected request details" onKeyDown={detailKeys} aria-busy={detailLoading}>
    <div className="section-heading"><h2>Request details</h2><button disabled={busy} onClick={()=>{setSelected(null);listRef.current?.focus();}}>Close details</button></div>
    {detailLoading&&<p role="status">Loading request details…</p>}
    {detailError&&<div><p role="alert">{detailError}</p><button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Reload details</button></div>}
    {detail&&<><p className="eyebrow">{divisionNames[detail.request.division]} · {stateLabel(detail.request.kind)}</p><h3>{detail.request.payload.title}</h3><p><strong>{stateLabel(detail.request.status)}</strong> · {detail.request.requester_name}</p><p className="muted">Submitted {date(detail.request.created_at)}</p>{detail.request.amount_ugx!=null&&<p>UGX {new Intl.NumberFormat('en-UG').format(detail.request.amount_ugx)}</p>}{detail.request.payload.description&&<p className="request-description">{detail.request.payload.description}</p>}{detail.request.payload.starts&&<p>{detail.request.payload.starts} to {detail.request.payload.ends}</p>}
     {detail.request.status==='pending'&&<p>Waiting on {detail.request.waiting_on}.</p>}
     {!action&&<div className="actions">{detail.request.can_decide&&<><button className="primary" disabled={busy} onClick={()=>void decide(true)}>Approve</button><button disabled={busy} onClick={()=>setAction('reject')}>Send back</button></>}{detail.request.can_withdraw&&<button disabled={busy} onClick={()=>setAction('withdraw')}>Withdraw request</button>}</div>}
     {action&&<form className="request-action" onSubmit={e=>{e.preventDefault();void(action==='withdraw'?withdraw():decide(false));}}><h4>{action==='withdraw'?'Withdraw this pending request?':'Send this request back'}</h4><p>{action==='withdraw'?'Approvals will stop. Existing decisions and this withdrawal remain in the history. A new request is needed to start again.':'Tell the requester what needs to change.'}</p><label>{action==='withdraw'?'Withdrawal reason (optional)':'Reason for sending back'}<textarea ref={reasonRef} maxLength={2000} required={action==='reject'} value={reason} onChange={e=>setReason(e.target.value)} rows={3}/></label><div className="actions"><button className="primary" disabled={busy||(action==='reject'&&!reason.trim())}>{busy?'Recording…':action==='withdraw'?'Confirm withdrawal':'Confirm send back'}</button><button type="button" disabled={busy} onClick={()=>{setAction(null);setReason('');}}>Keep request unchanged</button></div></form>}
     {detail.request.can_decide&&!action&&<p className="muted">With details focused: A approves; S opens Send back.</p>}
     <h3>Approval steps</h3><ol className="request-steps">{detail.steps.map(s=><li key={s.number}><strong>Step {s.number} · {s.type==='manager'?'Line manager':s.permission?.split('.').map(stateLabel).join(' ')||'Authorised approver'}</strong><p>{stateLabel(s.status)}{s.decided_by?` by ${s.decided_by}`:''}{s.decided_at?` · ${date(s.decided_at)}`:''}</p>{s.comment&&<blockquote>{s.comment}</blockquote>}</li>)}</ol>
     <h3>Activity timeline</h3><ol className="request-timeline">{detail.timeline.map(event=><li key={event.seq}><strong>{eventLabel(event.action,event.result)}{event.step?` · step ${event.step}`:''}</strong><p>{event.actor} · <time dateTime={event.at}>{date(event.at)}</time></p>{event.reason&&<blockquote>{event.reason}</blockquote>}</li>)}</ol>{!detail.timeline.length&&<p>No activity recorded.</p>}
    </>}
   </aside>}
  </div>
 </section>;
}
