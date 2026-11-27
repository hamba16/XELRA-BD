begin;
insert into rbac.role_perms values
 ('central_director','finance.read','all'),('central_director','finance.manage','all'),('central_director','suppliers.manage','all'),
 ('finance_manager','finance.read','all'),('finance_manager','finance.manage','all'),('finance_manager','journal.post','all'),
 ('finance_officer','finance.read','all'),('finance_officer','finance.manage','all'),
 ('finance_manager','payroll.prepare','all'),('hr_lead','payroll.approve.hr','all'),
 ('director_eng','payroll.approve.department','division'),('central_director','payroll.approve.department','all') on conflict do nothing;

-- UGX monetary values are whole shillings, computed from bounded explicit lines.
create function fin.line_total(p_lines jsonb) returns bigint language plpgsql immutable set search_path='' as $$
declare item jsonb; total numeric:=0; quantity numeric; unit numeric;
begin
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 or octet_length(p_lines::text)>65536 then raise exception 'Provide between 1 and 100 lines.'; end if;
 for item in select * from jsonb_array_elements(p_lines) loop
 if jsonb_typeof(item)<>'object' or length(btrim(coalesce(item->>'description',''))) not between 1 and 300
 or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_ugx') is distinct from 'number' then raise exception 'Each line needs a description, quantity and unit amount.'; end if;
 quantity:=(item->>'quantity')::numeric; unit:=(item->>'unit_ugx')::numeric;
 if quantity<=0 or quantity<>trunc(quantity) or unit<0 or unit<>trunc(unit) or quantity>1000000 or unit>1000000000000 then raise exception 'Use positive whole quantities and nonnegative whole UGX amounts.'; end if;
 total:=total+quantity*unit;
 end loop;
 if total<=0 or total>9000000000000 then raise exception 'Total amount is outside the supported range.'; end if;
 return total::bigint;
end $$;
create sequence fin.invoice_numbers;
create table fin.records(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('expense','requisition','invoice','supplier-bill','purchase-order')),
 division text not null references org.divisions,title text not null check(length(btrim(title)) between 1 and 200),
 project text references work.projects,supplier_id uuid references work.records,lines jsonb not null,total_ugx bigint not null check(total_ugx>0),
 document_id uuid references docs.files,due_on date,number text unique,
 status text not null default 'draft' check(status in ('draft','submitted','released','void')),
 request_id uuid unique references approvals.requests,version int not null default 1,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index finance_scope on fin.records(division,created_by,kind,created_at desc);
create index finance_project on fin.records(project);
create index finance_supplier on fin.records(supplier_id);
alter table fin.records enable row level security;
alter table fin.records force row level security;
create policy finance_read on fin.records for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 (division=any(((select rbac.divisions_for('finance.read'))::text[])) or (kind in ('expense','requisition') and created_by=(select auth.uid()))));
create function fin.save_record(p_kind text,p_division text,p_title text,p_lines jsonb,p_project text default null,p_supplier uuid default null,p_document uuid default null,p_due date default null,p_id uuid default null,p_version int default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare r fin.records; rid uuid; total bigint;
begin
 if not rbac.active(auth.uid()) or not (rbac.can('finance.manage',p_division) or (p_kind in ('expense','requisition') and rbac.member(p_division) and exists(select 1 from org.people where id=auth.uid() and principal='staff'))) then raise exception 'You cannot create this financial record.'; end if;
 total:=fin.line_total(p_lines);
 if p_project is not null and not exists(select 1 from work.projects where code=p_project and division=p_division and deleted_at is null and status<>'closed') then raise exception 'Choose an open project in this division.'; end if;
 if p_supplier is not null and not exists(select 1 from work.records where id=p_supplier and module='suppliers' and status='active' and deleted_at is null and division=p_division) then raise exception 'Choose an active supplier in this division.'; end if;
 if p_document is not null then perform work.document_detail(p_document); end if;
 if p_id is null then
 insert into fin.records(kind,division,title,lines,total_ugx,project,supplier_id,document_id,due_on,number,created_by)
 values(p_kind,p_division,btrim(p_title),p_lines,total,p_project,p_supplier,p_document,p_due,
 case when p_kind='invoice' then 'INV-'||lpad(nextval('fin.invoice_numbers')::text,8,'0') end,auth.uid()) returning id into rid;
 else
 select * into r from fin.records where id=p_id for update;
 if r.id is null or r.status<>'draft' or r.version is distinct from p_version or r.kind<>p_kind or r.division<>p_division or (r.created_by<>auth.uid() and not rbac.can('finance.manage',r.division)) then raise exception 'This draft changed or is not available to you.'; end if;
 update fin.records set title=btrim(p_title),lines=p_lines,total_ugx=total,project=p_project,supplier_id=p_supplier,document_id=p_document,due_on=p_due,version=version+1 where id=p_id;
 rid:=p_id;
 end if;
 perform audit.log('finance.saved','financial-record',rid::text,jsonb_build_object('kind',p_kind,'total_ugx',total)); return rid;
end $$;
create function fin.submit_record(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r fin.records; rid uuid;
begin
 select * into r from fin.records where id=p_id for update;
 if not rbac.active(auth.uid()) or r.id is null or r.created_by<>auth.uid() or r.status<>'draft' then raise exception 'Only the owner can submit this draft.'; end if;
 if r.kind not in ('expense','requisition') then raise exception 'Approval routing for this record type requires an agreed workflow. Keep it as a draft.'; end if;
 if r.kind='expense' and r.document_id is null then raise exception 'Attach a receipt document before submitting this claim.'; end if;
 if r.document_id is not null then
 perform work.document_detail(r.document_id);
 if not exists(select 1 from docs.files where id=r.document_id and object_key is not null and sha256 is not null) then raise exception 'The receipt document needs a file and checksum.'; end if;
 end if;
 -- Requisitions use the existing spending ladder, not the generic catch-all step.
 rid:=approvals.submit('expense',r.division,r.total_ugx,jsonb_build_object('title',r.title,'financial_record',r.id,'record_kind',r.kind));
 update approvals.requests set kind=r.kind where id=rid;
 update fin.records set status='submitted',request_id=rid,version=version+1 where id=p_id;
 insert into notifications.outbox(person_id,request_id,event) select p.id,rid,'approval.waiting' from org.people p where approvals.eligible(p.id,rid,1);
 perform audit.log('finance.submitted','financial-record',p_id::text,jsonb_build_object('request',rid)); return rid;
end $$;
create function fin.reopen_record(p_id uuid) returns int language plpgsql security definer set search_path='' as $$
declare r fin.records;
begin
 select * into r from fin.records where id=p_id for update;
 if not rbac.active(auth.uid()) or r.id is null or r.created_by<>auth.uid() or r.status<>'submitted' or not exists(select 1 from approvals.requests where id=r.request_id and status in ('rejected','cancelled')) then raise exception 'Only a returned or withdrawn claim can be revised.'; end if;
 perform audit.log('finance.reopened','financial-record',r.id::text,jsonb_build_object('previous_request',r.request_id));
 update fin.records set status='draft',request_id=null,version=version+1 where id=p_id; return r.version+1;
end $$;
create function fin.record_page(p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid financial page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select r.*,a.status as approval_status from fin.records r left join approvals.requests a on a.id=r.request_id
 where r.deleted_at is null and (r.division=any(rbac.divisions_for('finance.read')) or (r.kind in ('expense','requisition') and r.created_by=auth.uid()))
 order by r.created_at desc,r.id limit 50 offset p_offset)t),'[]');
end $$;

-- Configurable chart of accounts. No statutory accounting model or automatic posting.
create table fin.accounts(code text primary key check(code ~ '^[A-Za-z0-9._-]{1,40}$'),name text not null check(length(btrim(name)) between 1 and 200),active boolean not null default true);
alter table fin.accounts enable row level security;
alter table fin.accounts force row level security;
create policy accounts_read on fin.accounts for select to authenticated using((select rbac.can('finance.read')));
create table fin.journals(
 id uuid primary key default gen_random_uuid(),division text not null references org.divisions,date date not null,
 number text not null unique check(length(btrim(number)) between 1 and 80),description text not null check(length(description) between 1 and 500),
 lines jsonb not null,project text references work.projects,source_doc uuid references docs.files,
 created_by uuid not null references org.people,created_at timestamptz not null default now());
create index journals_scope on fin.journals(division,date);
create index journals_project on fin.journals(project);
alter table fin.journals enable row level security;
alter table fin.journals force row level security;
create policy journals_read on fin.journals for select to authenticated using(division=any(((select rbac.divisions_for('finance.read'))::text[])));
create function fin.save_account(p_code text,p_name text,p_active boolean default true) returns text language plpgsql security definer set search_path='' as $$
begin
 if not rbac.can('journal.post') then raise exception 'You cannot configure accounts.'; end if;
 insert into fin.accounts(code,name,active) values(p_code,btrim(p_name),p_active) on conflict(code) do update set name=excluded.name,active=excluded.active;
 perform audit.log('account.configured','account',p_code); return p_code;
end $$;
create function fin.post_journal(p_division text,p_date date,p_number text,p_description text,p_lines jsonb,p_project text default null,p_document uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare item jsonb; debit numeric; credit numeric; balance numeric:=0; rid uuid;
begin
 if not rbac.can('journal.post',p_division) then raise exception 'You cannot post journals.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 2 and 100 then raise exception 'Provide 2 to 100 journal lines.'; end if;
 if p_document is not null then perform work.document_detail(p_document); end if;
 if p_project is not null and not exists(select 1 from work.projects where code=p_project and division=p_division and deleted_at is null) then raise exception 'Choose a project in this division.'; end if;
 for item in select * from jsonb_array_elements(p_lines) loop
 if not exists(select 1 from fin.accounts where code=item->>'account_code' and active) then raise exception 'Choose an active configured account.'; end if;
 if jsonb_typeof(item->'debit') is distinct from 'number' or jsonb_typeof(item->'credit') is distinct from 'number' then raise exception 'Journal amounts must be numbers.'; end if;
 debit:=(item->>'debit')::numeric; credit:=(item->>'credit')::numeric;
 if debit<0 or credit<0 or debit<>trunc(debit) or credit<>trunc(credit) or (debit=0)=(credit=0) or greatest(debit,credit)>9000000000000 then raise exception 'Each journal line needs one positive whole UGX debit or credit.'; end if;
 balance:=balance+debit-credit;
 end loop;
 if balance<>0 then raise exception 'Journal debits and credits must balance.'; end if;
 insert into fin.journals(division,date,number,description,lines,project,source_doc,created_by) values(p_division,p_date,btrim(p_number),p_description,p_lines,p_project,p_document,auth.uid()) returning id into rid;
 perform audit.log('journal.posted','journal',rid::text,jsonb_build_object('number',p_number,'lines',jsonb_array_length(p_lines))); return rid;
end $$;
create function fin.journal_page(p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid journal page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select j.*,d.doc_no as source_doc_no from fin.journals j left join docs.files d on d.id=j.source_doc
 where j.division=any(rbac.divisions_for('finance.read')) order by date desc,j.id limit 50 offset p_offset)t),'[]');
end $$;

-- Payroll shadow periods: PAYE uses the pre-existing verified effective-dated engine.
-- Other deductions are explicit approved inputs, never guessed statutory formulas.
create table payroll.periods(
 id uuid primary key default gen_random_uuid(),division text not null references org.divisions,title text not null check(length(btrim(title)) between 1 and 200),
 starts date not null,ends date not null check(ends>=starts),status text not null default 'preparing' check(status in ('preparing','review','locked')),
 request_id uuid unique references approvals.requests,shadow boolean not null default true check(shadow),
 created_by uuid not null references org.people,created_at timestamptz not null default now(),locked_at timestamptz);
create index payroll_period_scope on payroll.periods(division,starts);
alter table payroll.periods enable row level security;
alter table payroll.periods force row level security;
create policy payroll_period_read on payroll.periods for select to authenticated using(division=any(((select rbac.divisions_for('payroll.read'))::text[])));
create table payroll.lines(
 id uuid primary key default gen_random_uuid(),period_id uuid not null references payroll.periods,person_id uuid not null references org.people,
 division text not null references org.divisions,gross_ugx bigint not null check(gross_ugx>=0),other_deductions_ugx bigint not null check(other_deductions_ugx>=0),
 input_note text not null check(length(btrim(input_note)) between 1 and 2000),paye_ugx bigint not null,net_ugx bigint not null check(net_ugx>=0),
 expected_net_ugx bigint check(expected_net_ugx>=0),rate_id uuid not null references payroll.rate_tables,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),unique(period_id,person_id));
create index payroll_lines_scope on payroll.lines(person_id,division,period_id);
alter table payroll.lines enable row level security;
alter table payroll.lines force row level security;
create policy payroll_lines_read on payroll.lines for select to authenticated using(division=any(((select rbac.divisions_for('payroll.read'))::text[])));
create function payroll.create_period(p_division text,p_title text,p_starts date,p_ends date) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.can('payroll.prepare',p_division) then raise exception 'You cannot prepare payroll.'; end if;
 insert into payroll.periods(division,title,starts,ends,created_by) values(p_division,btrim(p_title),p_starts,p_ends,auth.uid()) returning id into rid;
 perform audit.log('payroll.created','payroll-period',rid::text,jsonb_build_object('shadow',true)); return rid;
end $$;
create function payroll.save_line(p_period uuid,p_person uuid,p_gross bigint,p_deductions bigint,p_note text,p_expected bigint default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p payroll.periods; rid uuid; tax bigint; rate uuid;
begin
 select * into p from payroll.periods where id=p_period for update;
 if p.id is null or not rbac.can('payroll.prepare',p.division) or p.status<>'preparing' then raise exception 'This payroll period is not open for preparation.'; end if;
 if not exists(select 1 from org.people where id=p_person and principal='staff' and status='active') or not exists(select 1 from rbac.assignments where person_id=p_person and division=p.division and valid_from<=p.ends and (valid_to is null or valid_to>=p.starts)) then raise exception 'Choose an active employee assigned to this division in this period.'; end if;
 if p_gross is null or p_gross<0 or p_deductions is null or p_deductions<0 then raise exception 'Use nonnegative payroll inputs.'; end if;
 tax:=payroll.paye(p_gross,p.ends);
 select id into rate from payroll.rate_tables where kind='paye_resident_monthly' and effective @> p.ends;
 insert into payroll.lines(period_id,person_id,division,gross_ugx,other_deductions_ugx,input_note,paye_ugx,net_ugx,expected_net_ugx,rate_id,created_by)
 values(p_period,p_person,p.division,p_gross,p_deductions,btrim(p_note),tax,p_gross-tax-p_deductions,p_expected,rate,auth.uid())
 on conflict(period_id,person_id) do update set gross_ugx=excluded.gross_ugx,other_deductions_ugx=excluded.other_deductions_ugx,input_note=excluded.input_note,paye_ugx=excluded.paye_ugx,net_ugx=excluded.net_ugx,expected_net_ugx=excluded.expected_net_ugx,rate_id=excluded.rate_id returning id into rid;
 perform audit.log('payroll.input','payroll-period',p_period::text,jsonb_build_object('line',rid)); return rid;
end $$;
create function payroll.submit_period(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p payroll.periods; rid uuid;
begin
 select * into p from payroll.periods where id=p_id for update;
 if p.id is null or p.status<>'preparing' or not rbac.can('payroll.prepare',p.division) then raise exception 'You cannot submit this payroll period.'; end if;
 if not exists(select 1 from payroll.lines where period_id=p_id) then raise exception 'Add payroll inputs before review.'; end if;
 insert into approvals.requests(kind,division,requester,payload) values('payroll',p.division,auth.uid(),jsonb_build_object('title',p.title,'period_id',p_id,'shadow',true)) returning id into rid;
 insert into approvals.steps(request_id,step_no,step_type,perm) values(rid,1,'perm','payroll.approve.hr'),(rid,2,'perm','payroll.approve.department');
 update payroll.periods set status='review',request_id=rid where id=p_id;
 perform audit.log('payroll.submitted','payroll-period',p_id::text,jsonb_build_object('request',rid));
 insert into notifications.outbox(person_id,request_id,event) select pe.id,rid,'approval.waiting' from org.people pe where approvals.eligible(pe.id,rid,1);
 return rid;
end $$;
create function payroll.lock_period(p_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare p payroll.periods;
begin
 select * into p from payroll.periods where id=p_id for update;
 if p.id is null or p.status<>'review' or not rbac.can('payroll.prepare',p.division) then raise exception 'You cannot lock this payroll period.'; end if;
 if not exists(select 1 from approvals.requests where id=p.request_id and status='approved') then raise exception 'HR and department review must both be approved.'; end if;
 update payroll.periods set status='locked',locked_at=now() where id=p_id;
 perform audit.log('payroll.locked','payroll-period',p_id::text,jsonb_build_object('shadow',true)); return 'locked';
end $$;
create function payroll.workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return jsonb_build_object('periods',coalesce((select jsonb_agg(to_jsonb(p) order by starts desc) from payroll.periods p where division=any(rbac.divisions_for('payroll.read'))),'[]'),
 'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('variance_ugx',net_ugx-expected_net_ugx)) from payroll.lines l where division=any(rbac.divisions_for('payroll.read'))),'[]'),
 'payslips',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'period',p.title,'gross_ugx',l.gross_ugx,'paye_ugx',l.paye_ugx,'other_deductions_ugx',l.other_deductions_ugx,'net_ugx',l.net_ugx,'shadow',true)) from payroll.lines l join payroll.periods p on p.id=l.period_id where p.status='locked' and l.person_id=auth.uid()),'[]'));
end $$;

create function api.save_financial_record(p_kind text,p_division text,p_title text,p_lines jsonb,p_project text default null,p_supplier uuid default null,p_document uuid default null,p_due date default null,p_id uuid default null,p_version int default 0) returns uuid language sql security invoker set search_path='' as $$ select fin.save_record(p_kind,p_division,p_title,p_lines,p_project,p_supplier,p_document,p_due,p_id,p_version) $$;
create function api.submit_financial_record(p_id uuid) returns uuid language sql security invoker set search_path='' as $$ select fin.submit_record(p_id) $$;
create function api.reopen_financial_record(p_id uuid) returns int language sql security invoker set search_path='' as $$ select fin.reopen_record(p_id) $$;
create function api.financial_page(p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select fin.record_page(p_offset) $$;
create function api.save_account(p_code text,p_name text,p_active boolean default true) returns text language sql security invoker set search_path='' as $$ select fin.save_account(p_code,p_name,p_active) $$;
create function api.post_journal(p_division text,p_date date,p_number text,p_description text,p_lines jsonb,p_project text default null,p_document uuid default null) returns uuid language sql security invoker set search_path='' as $$ select fin.post_journal(p_division,p_date,p_number,p_description,p_lines,p_project,p_document) $$;
create function api.journal_page(p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select fin.journal_page(p_offset) $$;
create function api.create_payroll_period(p_division text,p_title text,p_starts date,p_ends date) returns uuid language sql security invoker set search_path='' as $$ select payroll.create_period(p_division,p_title,p_starts,p_ends) $$;
create function api.save_payroll_line(p_period uuid,p_person uuid,p_gross bigint,p_deductions bigint,p_note text,p_expected bigint default null) returns uuid language sql security invoker set search_path='' as $$ select payroll.save_line(p_period,p_person,p_gross,p_deductions,p_note,p_expected) $$;
create function api.submit_payroll_period(p_id uuid) returns uuid language sql security invoker set search_path='' as $$ select payroll.submit_period(p_id) $$;
create function api.lock_payroll_period(p_id uuid) returns text language sql security invoker set search_path='' as $$ select payroll.lock_period(p_id) $$;
create function api.payroll_workspace() returns jsonb language sql stable security invoker set search_path='' as $$ select payroll.workspace() $$;
grant usage on schema fin,payroll to authenticated;
grant select on fin.records,fin.accounts,fin.journals,payroll.periods,payroll.lines to authenticated;
grant execute on function fin.save_record(text,text,text,jsonb,text,uuid,uuid,date,uuid,integer),fin.submit_record(uuid),fin.reopen_record(uuid),fin.record_page(integer),
 fin.save_account(text,text,boolean),fin.post_journal(text,date,text,text,jsonb,text,uuid),fin.journal_page(integer),
 payroll.create_period(text,text,date,date),payroll.save_line(uuid,uuid,bigint,bigint,text,bigint),payroll.submit_period(uuid),payroll.lock_period(uuid),payroll.workspace(),
 api.save_financial_record(text,text,text,jsonb,text,uuid,uuid,date,uuid,integer),api.submit_financial_record(uuid),api.reopen_financial_record(uuid),api.financial_page(integer),
 api.save_account(text,text,boolean),api.post_journal(text,date,text,text,jsonb,text,uuid),api.journal_page(integer),
 api.create_payroll_period(text,text,date,date),api.save_payroll_line(uuid,uuid,bigint,bigint,text,bigint),api.submit_payroll_period(uuid),api.lock_payroll_period(uuid),api.payroll_workspace() to authenticated;
commit;
