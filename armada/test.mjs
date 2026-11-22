import { McpClient, describe, it, assert, assertIncludes, run } from "../_testkit/harness.mjs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");

// --- fake armada bus: in-memory, endpoint-compatible -----------------
const msgs = []; let seq = 0;
const jobs = new Map();
let postCalls = 0;

const fake = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.headers["x-bus-token"] !== "tok-test") return send(401, { error: "token salah" });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const b = raw ? JSON.parse(raw) : {};
    const q = Object.fromEntries(u.searchParams);
    if (req.method === "GET" && u.pathname === "/bus/topics")
      return send(200, { topics: [{ topic: "health/h1", n: 3, last_ts: Date.now() / 1000 - 30 }] });
    if (req.method === "GET" && u.pathname === "/bus/agents")
      return send(200, { agents: [{ agent: "wr-node-h1", host: "h1", n: 3, last_ts: Date.now() / 1000 - 30 }] });
    if (req.method === "GET" && u.pathname === "/bus/messages") {
      const list = msgs.filter((m) => m.topic === q.topic && m.seq > Number(q.since || 0));
      return send(200, { topic: q.topic, count: list.length, messages: list });
    }
    if (req.method === "GET" && u.pathname === "/bus/job/status") {
      const j = jobs.get(q.id);
      return j ? send(200, { state: j.state, cancel_req: false, exit_code: j.exit_code })
               : send(404, { error: "tidak ada" });
    }
    if (req.method === "GET" && u.pathname === "/bus/job/list")
      return send(200, { jobs: [...jobs.values()].filter((j) => !q.state || j.state === q.state) });
    if (req.method === "POST" && u.pathname === "/bus/post") {
      postCalls++;
      const m = { seq: ++seq, ts: Date.now() / 1000, topic: b.topic, agent: b.agent, host: "", kind: b.kind || "note", text: b.text };
      msgs.push(m);
      return send(200, { ok: true, seq: m.seq, topic: m.topic });
    }
    if (req.method === "POST" && u.pathname === "/bus/job/post") {
      if (b.dedupe && [...jobs.values()].find((j) => j.dedupe === b.dedupe)) {
        const old = [...jobs.values()].find((j) => j.dedupe === b.dedupe);
        return send(200, { id: old.id, state: old.state, deduped: true });
      }
      const j = { id: `j-${++seq}`, host: b.host, agent: "agent-t", mode: b.mode,
                    state: "queued", exit_code: null, dedupe: b.dedupe || null };
      jobs.set(j.id, j);
      // "daemon" langsung menyelesaikan job bertanda instan
      if (b.argv && b.argv[0] === "echo") {
        j.state = "done"; j.exit_code = 0;
        msgs.push({ seq: ++seq, ts: Date.now() / 1000, topic: `job/${j.id}`,
                    agent: "wr-node-h1", host: "h1", kind: "result",
                    text: JSON.stringify({ exit_code: 0, stdout: "hi\n", stderr: "" }) });
      }
      return send(200, { id: j.id, state: j.state });
    }
    if (req.method === "POST" && u.pathname === "/bus/job/cancel") {
      const j = jobs.get(b.id);
      if (!j) return send(404, { error: "tidak ada" });
      j.state = "cancelled";
      return send(200, { ok: true });
    }
    return send(404, { error: "tidak ada" });
  });
});

await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const PORT = fake.address().port;

const client = new McpClient(SERVER, {
  ARMADA_BUS_URL: `http://127.0.0.1:${PORT}`,
  ARMADA_BUS_TOKEN: "tok-test",
  ARMADA_AGENT: "test-agent",
});

describe("armada-mcp", () => {
  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["fleet_health", "fleet_jobs", "job_post", "job_status",
                     "job_watch", "job_tail", "job_cancel", "bus_note", "bus_read"])
      assert(tools.includes(t), `missing ${t}`);
  });

  it("fleet_health shows online host", async () => {
    const r = await client.callTool("fleet_health", {});
    assertIncludes(r.text, "h1");
    assertIncludes(r.text, "ok");
    assertIncludes(r.text, "wr-node-h1");
  });

  it("bus_note posts as configured agent", async () => {
    const r = await client.callTool("bus_note", { topic: "t1", text: "halo armada" });
    assertIncludes(r.text, "seq=");
    const m = msgs.find((x) => x.topic === "t1");
    assert(m && m.agent === "test-agent" && m.text === "halo armada", "note tersimpan benar");
  });

  it("bus_read returns the note", async () => {
    const r = await client.callTool("bus_read", { topic: "t1" });
    assertIncludes(r.text, "halo armada");
    assertIncludes(r.text, "test-agent");
  });

  it("job_post validates argv", async () => {
    const r = await client.callTool("job_post", { host: "h1", argv: "df -h" });
    assert(r.isError, "argv non-array harus error");
  });

  it("job lifecycle: post → watch → tail", async () => {
    const p = await client.callTool("job_post", { host: "h1", argv: ["echo", "hi"] });
    const id = p.text.match(/^(j-\d+)/)?.[1];
    assert(id, `id dari respons: ${p.text}`);
    const w = await client.callTool("job_watch", { id, max_wait_sec: 10 });
    assertIncludes(w.text, "done");
    const t = await client.callTool("job_tail", { id });
    assertIncludes(t.text, "exit=0");
    assertIncludes(t.text, "hi");
  });

  it("dedupe returns the same id", async () => {
    const a = await client.callTool("job_post", { host: "h1", argv: ["sleep", "9"], dedupe: "d9" });
    const b = await client.callTool("job_post", { host: "h1", argv: ["sleep", "9"], dedupe: "d9" });
    assertIncludes(b.text, "deduped");
    const idA = a.text.match(/^(j-\d+)/)?.[1], idB = b.text.match(/^(j-\d+)/)?.[1];
    assert(idA && idA === idB, `id sama: ${idA} vs ${idB}`);
  });

  it("cancel moves job to cancelled", async () => {
    const p = await client.callTool("job_post", { host: "h1", argv: ["sleep", "60"] });
    const id = p.text.match(/^(j-\d+)/)?.[1];
    await client.callTool("job_cancel", { id });
    const s = await client.callTool("job_status", { id });
    assertIncludes(s.text, "cancelled");
  });

  it("clear error when token missing", async () => {
    const c2 = new McpClient(SERVER, {
      ARMADA_BUS_URL: `http://127.0.0.1:${PORT}`,
      ARMADA_BUS_TOKEN: "", BUS_TOKEN: "", HOME: "/nonexistent",
    });
    await c2.start();
    const r = await c2.callTool("fleet_health", {});
    assert(r.isError && /TOKEN/i.test(r.text), "harus error token");
    await c2.stop();
  });
});

await client.start();
const { fail } = await run();
await client.stop();
fake.close();
process.exit(fail > 0 ? 1 : 0);
