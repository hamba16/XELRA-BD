// Never imported in a production build. Synthetic, in-memory walkthrough only.
import type {Backend,Snapshot,Division} from '../data';
export const marker='__XELRA_DEV_SWITCHER__';
const profile={id:'preview-director',name:'Sample Director',principal:'staff',permissions:['view.combined','projects.read','documents.read','people.read','records.read','records.create','approvals.read','payroll.read'],divisions:['ENG','AMG'] as Division[]};
const state:Snapshot={profile,requests:[{id:'sample-expense',kind:'expense',division:'ENG',requester:'sample-engineer',requester_name:'Sample Engineer',amount_ugx:6500000,payload:{title:'Roofing materials · P014'},status:'pending',current_step:2,steps:2,can_decide:true,waiting_on:'Sample Director',created_at:'2026-11-25T09:00:00Z'}],projects:[{code:'P014',title:'Kampala infrastructure survey',division:'ENG',budget_ugx:24000000,actual_ugx:8500000,progress:40},{code:'P022',title:'Lakeside property assessment',division:'AMG',budget_ugx:12000000,actual_ugx:4000000,progress:50}],documents:[],people:[{id:profile.id,full_name:profile.name,principal:'staff',status:'active'}],records:[]};
const reports=new Map<string,string>();
export const preview:Backend={
 async load(){return structuredClone(state);},
 async signOut(){},
 async rpc(name,args){
  if(name==='submit_request') {const id=crypto.randomUUID();state.requests.unshift({id,kind:String(args.p_kind),division:args.p_division as Division,requester:profile.id,requester_name:profile.name,amount_ugx:Number(args.p_amount)||undefined,payload:args.p_payload as {title:string},status:'pending',current_step:1,steps:2,can_decide:false,waiting_on:'Another authorised approver',created_at:new Date().toISOString()});return id;}
  if(name==='decide_request'){const r=state.requests.find(r=>r.id===args.p_id);if(!r?.can_decide)throw Error('Someone else needs to decide this request.');r.status=args.p_approve?'approved':'rejected';r.can_decide=false;return r.status;}
  if(name==='create_record'){const id=crypto.randomUUID();state.records.unshift({id,module:String(args.p_module),title:String(args.p_title),division:args.p_division as Division,status:'active',data:args.p_data as {description:string}});return id;}
  if(name==='sync_field_report'){const id=String(args.p_client),value=JSON.stringify(args);if(reports.has(id)&&reports.get(id)!==value)throw Error('Conflicting report.');const duplicate=reports.has(id);reports.set(id,value);return duplicate?'duplicate':'created';}
  throw Error('This action is not available in the walkthrough.');
 }
};
