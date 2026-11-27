import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

test("document lifecycle: scoped transitions, immutable hash gate and denied roles", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const director = id(11);
  const staff = id(12);
  const peer = id(13);
  const rows = async (sql, args) => (await db.query(sql, args)).rows;
  const value = async (sql, args) =>
    Object.values((await rows(sql, args))[0])[0];
  const as = async (user, fn) => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
    );
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  try {
    await db.exec(readFileSync("tests/bootstrap-postgres.sql", "utf8"));
    await db.exec(
      `create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query(
      "insert into org.people(id,full_name,email,principal) values($1,$2,$3,'staff'),($4,$5,$6,'staff'),($7,$8,$9,'staff')",
      [
        director,
        "Director",
        "director@xelra.test",
        staff,
        "Staff",
        "staff@xelra.test",
        peer,
        "Peer",
        "peer@xelra.test",
      ],
    );
    await db.exec(
      `insert into rbac.assignments(person_id,role_code,division) values
       ('${director}','central_director','COR'),
       ('${staff}','staff','ENG'),
       ('${peer}','staff','ENG');
       insert into work.projects(code,title,division,budget_ugx,actual_ugx,progress,created_by)
       values('P014','Survey','ENG',1000000,0,0,'${director}');
      `,
    );

    const draft = await as(staff, () =>
      value(
        "select api.create_document('ENG','P014','RPT','Survey report','Review extract')",
      ),
    );
    assert.match(
      await value(
        "select doc_no from docs.files where id=$1",
        [draft],
      ),
      /^DRN-ENG-P014-RPT-0001-R00$/,
    );
    await as(peer, () =>
      assert.rejects(
        () =>
          value("select api.submit_document($1)", [draft]),
        /cannot submit/,
      ),
    );
    await as(staff, () =>
      assert.rejects(
        () =>
          value(
            "select api.attach_document($1,$2,$3)",
            [draft, "documents/P014/report.pdf", "Z".repeat(64)],
          ),
        /lowercase SHA-256/,
      ),
    );
    await as(staff, () =>
      value(
        "select api.attach_document($1,$2,$3)",
        [
          draft,
          "documents/P014/report.pdf",
          "a".repeat(64),
        ],
      ),
    );
    assert.equal(
      await as(staff, () =>
        value("select api.submit_document($1)", [draft]),
      ),
      "in_review",
    );
    await as(staff, () =>
      assert.rejects(
        () => value("select api.release_document($1)", [draft]),
        /cannot release/,
      ),
    );
    assert.equal(
      await as(director, () =>
        value("select api.release_document($1)", [draft]),
      ),
      "released",
    );
    const revision = await as(director, () =>
      value(
        "select api.create_document_revision($1,'Survey report revised')",
        [draft],
      ),
    );
    assert.equal(
      await value("select status from docs.files where id=$1", [draft]),
      "released",
    );
    assert.equal(
      await value("select revision from docs.files where id=$1", [revision]),
      1,
    );
    assert.match(
      await value("select doc_no from docs.files where id=$1", [revision]),
      /R01$/,
    );
    const detail = await as(director, () =>
      value("select api.document_detail($1)", [revision]),
    );
    assert.equal(detail.document.status, "draft");
    assert.ok(detail.timeline.some((event) => event.action === "document.revision"));
    assert.match(await value('select doc_no from docs.files where id=$1',[revision]), /RPT-0001-R01$/);
    await as(director,()=>value('select api.attach_document($1,$2,$3)',[revision,'documents/P014/revision.pdf','b'.repeat(64)]));
    await as(director,()=>value('select api.submit_document($1)',[revision]));
    await as(director,()=>assert.rejects(()=>value('select api.release_document($1)',[revision]),/cannot decide/));
    await db.exec(`insert into rbac.assignments(person_id,role_code,division) values ('${peer}','director_eng','ENG')`);
    await as(peer,()=>value('select api.release_document($1)',[revision]));
    assert.equal(await value('select status from docs.files where id=$1',[draft]),'superseded');
    await as(director,()=>assert.rejects(()=>value('select api.attach_document($1,$2,$3)',[revision,'documents/P014/changed.pdf','c'.repeat(64)]),/Only draft/));
    await db.exec(`update org.people set status='suspended' where id='${staff}'`);
    await as(staff,()=>assert.rejects(()=>value('select api.document_detail($1)',[draft]),/not available/));
    assert.equal(await value('select ok from audit.verify()'),true);
    const later = await as(director,()=>value('select api.create_document_revision($1)',[revision]));
    await as(director,()=>value('select api.withdraw_document($1)',[later]));
    const retry = await as(director,()=>value('select api.create_document_revision($1)',[revision]));
    assert.match(await value('select doc_no from docs.files where id=$1',[retry]),/R03$/,'withdrawn R02 is never reused');
  } finally {
    await db.close();
  }
});
