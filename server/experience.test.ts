import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import type { AiProvider, ProviderRequest } from "./ai-provider-contract.js";
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "orbit-experience-"),
);
process.env.APP_ENV = "development";
process.env.NODE_ENV = "test";
process.env.BACKGROUND_JOBS_ENABLED = "false";
const api = await import("./index.js"),
  db = await import("./db.js"),
  service = await import("./experience-service.js"),
  ai = await import("./experience-ai.js"),
  backups = await import("./backup-service.js"),
  library = await import("./library-service.js"),
  search = await import("./search-service.js"),
  connection = await import("./database/connection.js");
await api.initializeServer();
const now = new Date().toISOString();
const [user, other] = ["experience-one", "experience-two"].map((id) =>
  db.createUser({
    id,
    email: id + "@example.invalid",
    password_hash: "synthetic",
    role: "user",
    disabled: 0,
    created_at: now,
    updated_at: now,
  }),
);
const draft = (title = "海边回忆") => ({
  title,
  summary: "记得的日落",
  content: "我喜欢那次日落，回程很堵。",
  tags: ["旅行"],
  experience: {
    schemaVersion: 1 as const,
    subtype: "travel" as const,
    time: { description: "上周末" },
    places: ["海边"],
    impression: "放松",
    repeatIntent: "conditional" as const,
    audienceNotes: ["适合慢慢走的人"],
    lessons: ["下次早点出发"],
    imageIds: [] as string[],
  },
});
const create = () => service.createSession(user.id, randomUUID());
const settle = async (id: string) => {
  for (let i = 0; i < 150; i++) {
    const s = service.sessionView(user.id, id);
    if (s.state !== "generating") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("synthetic generation did not settle");
};
let savedId: string, imageId: string, backup: Buffer;
const password = "synthetic-backup-password";
test("独立记录：归属、修订冲突、确认幂等、元数据版本和普通聊天隔离", async () => {
  let s = create();
  savedId = s.id;
  assert.deepEqual(service.createSession(user.id, s.id), s);
  assert.throws(() => service.sessionView(other.id, s.id), /无权/);
  s = service.organizeOriginal(
    user.id,
    s.id,
    s.revision,
    "上周末海边日落很好看。",
  );
  assert.equal(db.exportUserLibraryEntries(user.id).length, 0);
  assert.throws(
    () =>
      service.saveDraft(user.id, s.id, { expectedRevision: 0, draft: draft() }),
    /更新/,
  );
  s = service.saveDraft(user.id, s.id, {
    expectedRevision: s.revision,
    draft: draft(),
  });
  s = service.confirmSession(user.id, s.id, s.revision);
  assert.equal(service.confirmSession(user.id, s.id, 0).entryId, s.entryId);
  assert.equal(db.listLibraryEntryVersions(s.entryId!, user.id).length, 1);
  const updated = draft();
  updated.experience.lessons = ["独特下次建议"];
  s = service.saveDraft(user.id, s.id, {
    expectedRevision: s.revision,
    draft: updated,
  });
  assert.equal(
    search.searchAll(user.id, { query: "独特下次建议", scope: "library" })
      .results.length,
    0,
    "pending metadata must not enter station search",
  );
  s = service.confirmSession(user.id, s.id, s.revision);
  assert.equal(db.listLibraryEntryVersions(s.entryId!, user.id).length, 2);
  assert.equal(
    search.searchAll(user.id, { query: "独特下次建议", scope: "library" })
      .results.length,
    1,
  );
  assert.equal(search.searchLibraryForAi(user.id, "海边", 5).length, 0);
  assert.equal(
    connection.queryAll("SELECT * FROM ai_schedule_messages WHERE user_id=?", [
      user.id,
    ]).length,
    0,
  );
  assert.equal(
    connection.queryAll("SELECT * FROM orbit_conversations WHERE user_id=?", [
      user.id,
    ]).length,
    0,
  );
  assert.throws(
    () =>
      library.publishLibraryArticle(user.id, {
        ...draft(),
        sourceId: "orbit-experience:" + s.id,
      }),
    /独立入口/,
  );
  assert.throws(
    () =>
      library.publishLibraryArticle(user.id, {
        ...draft(),
        sourceId: "  orbit-experience:" + s.id + "  ",
      }),
    /独立入口/,
  );
  assert.throws(
    () =>
      library.publishLibraryArticle(user.id, {
        ...draft(),
        sourceId: "external-source",
        sourceType: " orbit_experience ",
      }),
    /独立入口/,
  );
});
test("照片：大请求、处理、去重、不同内容拒绝、照片数与跨会话边界", async () => {
  const server = api.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" +
    (
      server.address() as {
        port: number;
      }
    ).port;
  const request = (p: string, owner = user, body?: unknown) =>
    fetch(base + p, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + api.signUserToken(owner),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(
      (await fetch(base + "/api/library/experience-sessions/" + savedId))
        .status,
      401,
    );
    assert.equal(
      (await request("/api/library/experience-sessions/" + savedId, other))
        .status,
      404,
    );
    const bytes = await sharp(randomBytes(1024 * 512 * 3), {
      raw: { width: 1024, height: 512, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    assert.ok(bytes.length > 1024 * 1024);
    let s = service.sessionView(user.id, savedId);
    const input = {
      requestId: randomUUID(),
      expectedRevision: s.revision,
      name: "回忆.png",
      mime: "image/png",
      base64: bytes.toString("base64"),
    };
    const result = await request(
      "/api/library/experience-sessions/" + s.id + "/images",
      user,
      input,
    );
    assert.equal(result.status, 200);
    const uploaded = await result.json();
    s = uploaded.session;
    imageId = uploaded.image.id;
    assert.equal(
      (await service.uploadImage(user.id, s.id, input)).image.id,
      imageId,
    );
    await assert.rejects(
      () =>
        service.uploadImage(user.id, s.id, { ...input, name: "另一张.png" }),
      /另一张/,
    );
    assert.equal(
      (
        await request(
          "/api/library/experience-sessions/images/" + imageId,
          other,
        )
      ).status,
      404,
    );
    assert.ok(service.readImage(user.id, imageId).bytes.length);
    const separate = create();
    assert.throws(
      () =>
        service.saveDraft(user.id, separate.id, {
          expectedRevision: separate.revision,
          imageIds: [imageId],
        }),
      /无权/,
    );
    for (let i = 0; i < 2; i++) {
      const add = await service.uploadImage(user.id, s.id, {
        ...input,
        requestId: randomUUID(),
        expectedRevision: s.revision,
      });
      s = add.session;
    }
    await assert.rejects(
      () =>
        service.uploadImage(user.id, s.id, {
          ...input,
          requestId: randomUUID(),
          expectedRevision: s.revision,
        }),
      /三张/,
    );
    s = service.confirmSession(user.id, s.id, s.revision);
    const versions = db.listLibraryEntryVersions(s.entryId!, user.id);
    assert.equal(
      JSON.parse(versions[0].metadata_json!).experience.imageIds.length,
      3,
    );
    s = service.saveDraft(user.id, s.id, {
      expectedRevision: s.revision,
      imageIds: [],
    });
    s = service.confirmSession(user.id, s.id, s.revision);
    assert.ok(
      service.readImage(user.id, imageId).bytes.length,
      "old snapshot retains photos",
    );
    backup = backups.createUserBackup(user.id, password);
  } finally {
    await new Promise<void>((r, e) =>
      server.close((err) => (err ? e(err) : r())),
    );
  }
});
test("AI：少量追问、照片不输入模型、幂等请求、评分不推断和直接整理", async () => {
  let s = create();
  const requests: ProviderRequest[] = [];
  const fake: AiProvider = {
    id: "chatgpt",
    generate: async (req) => {
      requests.push(req);
      return requests.length === 1
        ? JSON.stringify({ mode: "followup", question: "下次有什么想改变的？" })
        : JSON.stringify({
            mode: "draft",
            draft: {
              ...draft(),
              experience: {
                ...draft().experience,
                rating: { value: 5, scale: 5, description: "AI猜测" },
              },
            },
          });
    },
  };
  const input = {
    requestId: randomUUID(),
    expectedRevision: s.revision,
    text: "我去了海边",
    provider: "chatgpt" as const,
    model: "synthetic-luna",
  };
  await ai.startExperienceRun(user.id, s.id, input, fake);
  await ai.startExperienceRun(user.id, s.id, input, fake);
  s = await settle(s.id);
  assert.equal(requests.length, 1);
  assert.equal(s.data.followUps, 1);
  assert.equal(s.data.messages.filter((m) => m.role === "user").length, 1);
  await assert.rejects(
    () =>
      ai.startExperienceRun(
        user.id,
        s.id,
        { ...input, text: "另一条输入" },
        fake,
      ),
    /另一条/,
  );
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      ...input,
      requestId: randomUUID(),
      expectedRevision: s.revision,
      text: "想早点出发",
      finish: true,
    },
    fake,
  );
  s = await settle(s.id);
  assert.equal(s.state, "ready");
  assert.equal(s.data.draft?.experience.rating, undefined);
  assert.ok(
    requests.every(
      (r) =>
        r.input.every((p) => p.type === "text") && !r.webSearch && !r.tools,
    ),
  );
  const rated = draft();
  (rated.experience as any).rating = {
    value: 4,
    scale: 5,
    description: "我给4分",
  };
  ai.guardRating(rated, [{ role: "user", text: "我给4分", at: now }]);
  assert.equal((rated.experience as any).rating.value, 4);
  ai.guardRating(rated, [
    { role: "user", text: "14元门票，评分以后再说", at: now },
  ]);
  assert.equal(
    (rated.experience as any).rating,
    undefined,
    "ticket prices are not explicit ratings",
  );
});
test("联网：窄范围原生搜索、候选确认续接、主观问题不搜索、无来源不伪成功", async () => {
  let s = create();
  let calls = 0;
  const fake: AiProvider = {
    id: "chatgpt",
    generate: async (req) => {
      calls++;
      if (calls === 1)
        return JSON.stringify({
          mode: "lookup",
          quote: "我忘了海边那座博物馆名字",
          query: "2024年海边博物馆名称",
        });
      if (calls === 3) {
        assert.equal(req.webSearch, undefined);
        const context = JSON.parse((req.input[0] as { text: string }).text);
        assert.equal(
          context.lookupCandidates[0].sources[0].url,
          "https://example.org/museum",
        );
        assert.match(context.lookupCandidates[0].reply, /候选是某博物馆/);
        assert.match(context.messages.at(-1).text, /确认是这个馆/);
        assert.match(req.instructions, /只有用户明确确认/);
        return JSON.stringify({ mode: "draft", draft: draft() });
      }
      assert.equal(req.webSearch, true);
      assert.equal(req.tools, undefined);
      assert.ok(!JSON.stringify(req.input).includes("未分享的感受"));
      req.onWebSource?.({
        title: "官方博物馆",
        url: "https://example.org/museum",
        source: "example.org",
        snippet: "候选馆名",
        publishedAt: null,
        retrievedAt: now,
      });
      return "候选是某博物馆，需你确认是否去过。";
    },
  };
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      requestId: randomUUID(),
      expectedRevision: s.revision,
      text: "我忘了海边那座博物馆名字，但我记得很安静。未分享的感受",
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    fake,
  );
  s = await settle(s.id);
  assert.equal(calls, 2);
  assert.equal(s.data.lookups.length, 1);
  assert.equal(s.data.draft, null);
  assert.ok(s.data.messages[0].text.includes("记得很安静"));
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      requestId: randomUUID(),
      expectedRevision: s.revision,
      text: "确认是这个馆，可以整理了",
      finish: true,
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    fake,
  );
  s = await settle(s.id);
  assert.equal(calls, 3);
  assert.equal(s.state, "ready");
  assert.equal(
    s.entryId,
    null,
    "confirming a candidate must not publish the draft",
  );
  assert.equal(
    ai.isLookupAuthorized(
      "我不确定是否喜欢",
      [{ role: "user", text: "我不确定是否喜欢", at: now }],
      "这次旅行好玩吗",
    ),
    false,
  );
  let missing = create();
  let failedCalls = 0;
  const noSource: AiProvider = {
    id: "chatgpt",
    generate: async () =>
      ++failedCalls === 1
        ? JSON.stringify({
            mode: "lookup",
            quote: "请查博物馆名称",
            query: "博物馆名称",
          })
        : "没有工具却给出了答案",
  };
  await ai.startExperienceRun(
    user.id,
    missing.id,
    {
      requestId: randomUUID(),
      expectedRevision: missing.revision,
      text: "请查博物馆名称",
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    noSource,
  );
  missing = await settle(missing.id);
  assert.match(missing.data.error!, /来源/);
  assert.equal(missing.data.lookups.length, 0);
  assert.equal(missing.data.requests.at(-1)!.status, "failed");
});
test("取消、延迟响应、崩溃恢复和生成失败保留原话", async () => {
  let s = create();
  let resolve!: (text: string) => void;
  const deferred: AiProvider = {
    id: "chatgpt",
    generate: () =>
      new Promise((r) => {
        resolve = r;
      }),
  };
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      requestId: randomUUID(),
      expectedRevision: s.revision,
      text: "别丢我的原话",
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    deferred,
  );
  s = service.sessionView(user.id, s.id);
  s = ai.cancelExperienceRun(user.id, s.id, s.revision);
  const cancelled = s.revision;
  resolve(JSON.stringify({ mode: "draft", draft: draft() }));
  await new Promise((r) => setTimeout(r, 20));
  s = service.sessionView(user.id, s.id);
  assert.equal(s.revision, cancelled);
  assert.equal(s.data.draft, null);
  assert.equal(s.data.messages[0].text, "别丢我的原话");
  let interrupted = create();
  const data = service.dataOf(service.ownedSession(user.id, interrupted.id));
  data.requests = [
    { id: randomUUID(), fingerprint: "a".repeat(64), status: "running" },
  ];
  service.writeSession(
    service.ownedSession(user.id, interrupted.id),
    data,
    "generating",
  );
  ai.recoverExperienceRuns();
  interrupted = service.sessionView(user.id, interrupted.id);
  assert.equal(interrupted.data.requests[0].status, "interrupted");
  let failed = create();
  await ai.startExperienceRun(
    user.id,
    failed.id,
    {
      requestId: randomUUID(),
      expectedRevision: 0,
      text: "正文仍在",
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    { id: "chatgpt", generate: async () => "{malformed json" },
  );
  failed = await settle(failed.id);
  assert.equal(failed.data.requests[0].status, "failed");
  assert.equal(failed.data.messages[0].text, "正文仍在");
});
test("WorkBuddy 联网只开放搜索和网页读取，不取得普通 Orbit 工具权限", async () => {
  let s = create(),
    calls = 0;
  const fake: AiProvider = {
    id: "workbuddy",
    generate: async (request) => {
      if (++calls === 1)
        return JSON.stringify({
          mode: "lookup",
          quote: "请核查博物馆名称",
          query: "博物馆名称",
        });
      assert.equal(request.webSearch, false);
      assert.deepEqual(
        request.tools?.map((tool) => tool.name),
        ["search", "read_url"],
      );
      request.onWebSource?.({
        title: "合成来源",
        url: "https://example.org/museum",
        source: "example.org",
        snippet: "合成候选",
        publishedAt: null,
        retrievedAt: now,
      });
      return "待用户确认的合成候选";
    },
  };
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      requestId: randomUUID(),
      expectedRevision: s.revision,
      text: "请核查博物馆名称",
      provider: "workbuddy",
      model: "synthetic-glm",
    },
    fake,
  );
  s = await settle(s.id);
  assert.equal(s.data.lookups.length, 1);
  assert.equal(s.data.draft, null);
});
test("账号停用后的迟到生成不得写入，重新启用后可停止原任务", async () => {
  let s = create();
  let resolve!: (text: string) => void;
  await ai.startExperienceRun(
    user.id,
    s.id,
    {
      requestId: randomUUID(),
      expectedRevision: 0,
      text: "测试原话",
      provider: "chatgpt",
      model: "synthetic-luna",
    },
    {
      id: "chatgpt",
      generate: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  );
  connection.run("UPDATE users SET disabled=1 WHERE id=?", [user.id]);
  resolve(JSON.stringify({ mode: "draft", draft: draft() }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(service.sessionView(user.id, s.id).data.draft, null);
  connection.run("UPDATE users SET disabled=0 WHERE id=?", [user.id]);
  s = service.sessionView(user.id, s.id);
  ai.cancelExperienceRun(user.id, s.id, s.revision);
  assert.equal(service.sessionView(user.id, s.id).state, "collecting");
});
test("加密备份：同账号合并保护新编辑、跨账号映射、版本图片与完整导出", () => {
  let s = service.sessionView(user.id, savedId);
  s = service.saveDraft(user.id, s.id, {
    expectedRevision: s.revision,
    draft: draft("保存后新编辑"),
  });
  s = service.confirmSession(user.id, s.id, s.revision);
  backups.restoreUserBackup(user.id, backup, password, "merge");
  assert.equal(db.getLibraryEntry(s.entryId!, user.id)!.title, "保存后新编辑");
  const restored = backups.restoreUserBackup(
    other.id,
    backup,
    password,
    "replace",
  );
  assert.equal(restored.status, "COMPLETED");
  assert.equal(restored.idsRemapped, true);
  const rows = service.exportExperience(other.id).sessions;
  const copy = rows.find((r) => r.entry_id)!;
  assert.notEqual(copy.id, savedId);
  assert.notEqual(copy.entry_id, s.entryId);
  const versions = db.listLibraryEntryVersions(copy.entry_id!, other.id);
  const refs = JSON.parse(
    versions.find(
      (v) => JSON.parse(v.metadata_json!).experience.imageIds.length,
    )!.metadata_json!,
  ).experience.imageIds;
  assert.notEqual(refs[0], imageId);
  assert.ok(service.readImage(other.id, refs[0]).bytes.length);
  const exported = service.exportExperience(other.id, copy.id, true);
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.files!.length, 3);
  assert.equal(exported.versions.length, 4);
  assert.equal(exported.sessions[0].user_id, other.id);
  assert.ok(library.exportLibraryBundle(other.id).experience?.files?.length);
});
test("旧备份与缺图：替换保护、部分恢复标记、缺图可再备份、错误归属拒绝", () => {
  const raw = backups.decryptBackup<any>(backup, password),
    legacy = structuredClone(raw);
  delete legacy.experience;
  legacy.libraryEntries = legacy.libraryEntries.filter(
    (e: any) => e.source_type !== "orbit_experience",
  );
  assert.throws(
    () =>
      backups.restoreUserBackup(
        other.id,
        backups.encryptBackup(legacy, password),
        password,
        "replace",
      ),
    /合并/,
  );
  const missing = structuredClone(raw);
  missing.files = missing.files.filter((f: any) => f.attachmentId !== imageId);
  const result = backups.restoreUserBackup(
    other.id,
    backups.encryptBackup(missing, password),
    password,
    "replace",
  );
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.missingExperienceImages, [imageId]);
  const rebackup = backups.createUserBackup(other.id, password);
  assert.ok(backups.inspectUserBackup(rebackup, password));
  const bad = structuredClone(raw);
  bad.experience.images[0].session_id = randomUUID();
  assert.throws(
    () =>
      backups.restoreUserBackup(
        other.id,
        backups.encryptBackup(bad, password),
        password,
        "merge",
      ),
    /图片/,
  );
});
test("归档、恢复与永久删除只影响管理的经历和所属照片", () => {
  let s = service.sessionView(user.id, savedId);
  const pending = draft();
  pending.experience.lessons = ["归档恢复前未确认的信息"];
  s = service.saveDraft(user.id, s.id, {
    expectedRevision: s.revision,
    draft: pending,
  });
  assert.ok(service.listSessions(user.id).some((row) => row.id === s.id));
  service.experienceLifecycle(user.id, s.id, s.revision, "archive");
  s = service.sessionView(user.id, s.id);
  assert.equal(db.getLibraryEntry(s.entryId!, user.id)!.status, "archived");
  assert.throws(
    () =>
      service.saveDraft(user.id, s.id, {
        expectedRevision: s.revision,
        draft: draft(),
      }),
    /恢复/,
  );
  service.experienceLifecycle(user.id, s.id, s.revision, "restore");
  s = service.sessionView(user.id, s.id);
  assert.equal(db.getLibraryEntry(s.entryId!, user.id)!.status, "active");
  assert.equal(
    search.searchAll(user.id, {
      query: "归档恢复前未确认的信息",
      scope: "library",
    }).results.length,
    0,
  );
  assert.equal(s.state, "ready");
  assert.throws(
    () => service.experienceLifecycle(user.id, s.id, s.revision, "purge"),
    /归档/,
  );
  service.experienceLifecycle(user.id, s.id, s.revision, "archive");
  s = service.sessionView(user.id, s.id);
  service.experienceLifecycle(user.id, s.id, s.revision, "purge");
  assert.throws(() => service.readImage(user.id, imageId), /无权/);
  assert.throws(() => service.sessionView(user.id, s.id), /无权/);
  assert.ok(service.exportExperience(other.id).sessions.length);
});
