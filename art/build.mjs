// devmcp-flow — "The Recall Bench" (anatomy-style isometric figure)
// Satu meja kerja untuk memori agen: slip sesi masuk ke jurnal DEVJOURNAL,
// tumpukan konteks dipres jadi bundel berlabel oleh CONTEXT-PACK, laci
// kartu PROJECT-MEMORY mengarsipnya dengan kaca pembesar pencari, dan
// rak canister CHECKPOINT menyimpan rol titik-pulih.
// Build: node art/build.mjs           → art/devmcp-flow.svg       (dark)
//        node art/build.mjs --light   → art/devmcp-flow-light.svg
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIGHT = process.argv.includes("--light");
const WIDTH = 760, HEIGHT = 470;

const BENCH = { x: -170, y: -70, w: 340, d: 140, r: 8 };
const BENCH_H = 11, FOOT_H = 7;

// devjournal: buku terbuka + baki slip
const BOOKL = { x: -160, y: -38, w: 24, d: 30, r: 0.8 };
const BOOKR = { x: -136, y: -38, w: 24, d: 30, r: 0.8 };
const TRAY = { x: -166, y: -62, w: 18, d: 13, r: 1.2 };

// context-pack: pres bundel
const POST_L = { x: -76, y: -34 }, POST_R = { x: -40, y: -34 };
const POST_H = 30;
const BEAM = { x: -80, y: -38, w: 44, d: 12, r: 1 };
const PLATE = { x: -66, y: -30, w: 20, d: 16, r: 1 };
const BUNDLE = { x: -30, y: -12, w: 17, d: 14, r: 1 };

// project-memory: lemari katalog + kaca pembesar
const CAB = { x: 4, y: -40, w: 56, d: 38, r: 2.5 };
const CAB_H = 44;
const DRAWER = { x: 14, y: -2, w: 20, d: 12, r: 1 };

// checkpoint: rak canister
const RACK = { x: 92, y: -54, w: 72, d: 18, r: 1.5 };
const REELS = [
  { x: 98, h: 14, tag: "r1" },
  { x: 114, h: 20, tag: "r2" },
  { x: 130, h: 17, tag: "r3" },
  { x: 146, h: 22, tag: "r4" },
];

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -FOOT_H, BENCH_H + 60), [0, 0, -FOOT_H - 2]],
  WIDTH, HEIGHT, { pad: 24, azimuth: 45 });

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const Dt = (points, style) => k.dotsSvg(points, style);
const T = (m, text, o) => k.faceTextSvg(m, text, o);
const topText = (at2, z, text, o = {}) =>
  T(k.topMatrix(at2, z, P, "x"), text, { size: 4.4, tone: "mid", ...o });
const seg = (a, b, w = 3.2, tone = "hi") =>
  `<path class="iso-line" data-tone="${tone}" d="${k.pathOf([at(a), at(b)])}" style="stroke-width:${w}"/>`;
const faceText = ([x, y, z], text, o = {}) => {
  const [sx, sy] = at([x, y, z]);
  return `<text class="iso-face-text" data-tone="${o.tone || "hi"}" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" font-size="${o.size || 4.2}" text-anchor="${o.anchor || "middle"}">${text}</text>`;
};
const FY = BENCH.y + BENCH.d + 0.4;   // muka depan meja
// papan nama: slab tipis di atas meja, teks top-plane terbaca jelas
function nameplate(cx, cy, w, text) {
  const plate = { x: cx - w / 2, y: cy - 4.5, w, d: 9, r: 1 };
  return [
    S(k.slabOf(plate, BENCH_H + 0.2, 1.0, P, 2), { tone: "lo", crease: "none" }),
    topText([cx, cy + 0.8], BENCH_H + 1.4, text,
      { size: text.length > 9 ? 2.9 : 3.4, anchor: "middle", tone: "hi" }),
  ].join("");
}

// ---------- meja ----------
function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BENCH, -FOOT_H, BENCH_H, P)}"/>`];
  for (const [x, y] of k.corners(BENCH, 20)) {
    out.push(S(k.cylinder(x, y, 8, -FOOT_H, 2, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.6, -FOOT_H + 2, FOOT_H - 2, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BENCH, 0, BENCH_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BENCH, 6), BENCH_H, P), { tone: "faint" }));
  const screws = k.corners(BENCH, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.1, BENCH_H, P, 14)).join(""), { tone: "lo" }));
  out.push(Dt(screws.map(([x, y]) => at([x, y, BENCH_H])), { size: 0.5 }));
  return out.join("");
}

// ---------- devjournal: baki slip + jurnal terbuka + pena ----------
function journal() {
  const out = [];
  // baki slip masuk di pojok kiri belakang, di atas kaki pendek
  for (const [x, y] of k.corners(TRAY, 3))
    out.push(S(k.cylinder(x, y, 1.0, BENCH_H, 8, P, 8), { tone: "lo" }));
  out.push(S(k.slabOf(TRAY, BENCH_H + 8, 1.1, P, 2), { tone: "lo" }));
  // dua slip masih di baki
  for (let i = 0; i < 2; i++) {
    const s = { x: TRAY.x + 3 + i * 5, y: TRAY.y + 3 + i * 2.5, w: 10, d: 8, r: 0.5 };
    out.push(S(k.slabOf(s, BENCH_H + 9.1 + i * 0.8, 0.8, P, 2), { tone: "hi" }));
  }
  // satu slip meluncur dari baki ke halaman kiri buku (garis putus)
  out.push(k.wireSvg(
    at([TRAY.x + TRAY.w, TRAY.y + TRAY.d / 2, BENCH_H + 9]),
    at([BOOKL.x + 10, BOOKL.y + 4, BENCH_H + 4]),
    { tone: "lo", dashed: true, ends: "none", size: 0.8 }));
  // buku terbuka: dua halaman + punggung
  out.push(S(k.slabOf(BOOKL, BENCH_H + 1.6, 1.6, P, 2, 0.4), { tone: "hi" }));
  out.push(S(k.slabOf(BOOKR, BENCH_H + 1.6, 1.6, P, 2, 0.4), { tone: "hi" }));
  const spine = { x: BOOKL.x + BOOKL.w - 0.6, y: BOOKL.y, w: 1.2, d: BOOKL.d, r: 0.4 };
  out.push(S(k.slabOf(spine, BENCH_H + 0.6, 1.0, P, 2), { tone: "mid" }));
  // baris tulisan di tiap halaman
  for (let r = 0; r < 4; r++) {
    out.push(L(k.pathOf([
      at([BOOKL.x + 3, BOOKL.y + 5 + r * 5.4, BENCH_H + 3.4]),
      at([BOOKL.x + 20, BOOKL.y + 5 + r * 5.4, BENCH_H + 3.4])]), { tone: "faint" }));
    out.push(L(k.pathOf([
      at([BOOKR.x + 4, BOOKR.y + 5 + r * 5.4, BENCH_H + 3.4]),
      at([BOOKR.x + 21, BOOKR.y + 5 + r * 5.4, BENCH_H + 3.4])]), { tone: "faint" }));
  }
  // pita pembatas menjuntai dari tepi depan halaman kiri
  const rib = { x: BOOKL.x + 12, y: BOOKL.y + BOOKL.d - 1, w: 2.6, d: 9, r: 0.6 };
  out.push(S(k.slabOf(rib, BENCH_H + 0.4, 1.0, P, 2), { tone: "lit" }));
  // pena di atas halaman kanan: batang + ujung
  out.push(seg(
    [BOOKR.x + 6, BOOKR.y + 8, BENCH_H + 4.6],
    [BOOKR.x + 18, BOOKR.y + 20, BENCH_H + 4.6], 1.6, "hi"));
  out.push(seg(
    [BOOKR.x + 18, BOOKR.y + 20, BENCH_H + 4.6],
    [BOOKR.x + 21, BOOKR.y + 23.5, BENCH_H + 4.0], 0.9, "mid"));
  out.push(Dt([at([BOOKR.x + 21, BOOKR.y + 23.5, BENCH_H + 3.8])], { size: 0.6, tone: "hi" }));
  // label sesi di halaman kanan (kotak kecil + titik)
  out.push(L(k.pathOf([
    at([BOOKR.x + 4, BOOKR.y + 25.5, BENCH_H + 3.4]),
    at([BOOKR.x + 12, BOOKR.y + 25.5, BENCH_H + 3.4])]), { tone: "mid" }));
  out.push(Dt([at([BOOKR.x + 14.5, BOOKR.y + 25.5, BENCH_H + 3.4])], { size: 0.5, tone: "lit" }));
  out.push(nameplate(-120, 18, 52, "devjournal"));
  out.push(faceText([-121, FY, BENCH_H * 0.55], "JOURNAL"));
  return out.join("");
}

// ---------- context-pack: pres bundel ----------
function press() {
  const out = [];
  // dua tiang + balok atas
  for (const p of [POST_L, POST_R])
    out.push(S(k.cylinder(p.x + 3, p.y + 3, 3.8, BENCH_H, POST_H, P, 16), { tone: "mid" }));
  out.push(S(k.slabOf(BEAM, BENCH_H + POST_H, 6, P, 3, 0.8), { tone: "mid" }));
  // sekrup balok
  for (const p of [POST_L, POST_R])
    out.push(Dt([at([p.x + 3, p.y + 3, BENCH_H + POST_H + 5.4])], { size: 0.5 }));
  // roda tangan di atas balok
  const wx = BEAM.x + BEAM.w / 2, wy = BEAM.y + BEAM.d / 2;
  out.push(S(k.cylinder(wx, wy, 1.8, BENCH_H + POST_H + 6, 4, P, 12), { tone: "mid" }));
  out.push(L(k.ring(wx, wy, 5.2, BENCH_H + POST_H + 10, P, 24), { tone: "hi" }));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    out.push(seg(
      [wx + Math.cos(a) * 1.6, wy + Math.sin(a) * 1.6, BENCH_H + POST_H + 10],
      [wx + Math.cos(a) * 5.2, wy + Math.sin(a) * 5.2, BENCH_H + POST_H + 10], 0.7, "mid"));
  }
  // batang plunger dari balok ke pelat tekan
  out.push(S(k.cylinder(wx, wy, 2.0, BENCH_H + 19, POST_H - 13, P, 12), { tone: "hi" }));
  out.push(S(k.slabOf(PLATE, BENCH_H + 15, 2.4, P, 2, 0.5), { tone: "hi" }));
  // tumpukan kartu konteks di bawah pelat (3 lembar)
  for (let i = 0; i < 3; i++) {
    const c = { x: PLATE.x + 2 + i * 0.5, y: PLATE.y + 2 + i * 0.5, w: PLATE.w - 4, d: PLATE.d - 4, r: 0.7 };
    out.push(S(k.slabOf(c, BENCH_H + 10 - i * 1.6, 1.3, P, 2), { tone: i === 1 ? "hi" : "mid" }));
  }
  // bundel jadi di depan pres: slab + pita silang + label "ctx"
  out.push(S(k.slabOf(BUNDLE, BENCH_H + 2, 8, P, 2, 0.5), { tone: "hi" }));
  const bx = BUNDLE.x + BUNDLE.w / 2, bz = BENCH_H + 10.2;
  out.push(L(k.pathOf([
    at([bx, BUNDLE.y, bz]), at([bx, BUNDLE.y + BUNDLE.d, bz])]), { tone: "mid" }));
  out.push(L(k.pathOf([
    at([BUNDLE.x, BUNDLE.y + BUNDLE.d / 2, bz]),
    at([BUNDLE.x + BUNDLE.w, BUNDLE.y + BUNDLE.d / 2, bz])]), { tone: "mid" }));
  const tag = { x: BUNDLE.x + 2, y: BUNDLE.y + BUNDLE.d - 6.5, w: 8, d: 5, r: 0.5 };
  out.push(S(k.slabOf(tag, BENCH_H + 10.2, 0.7, P, 2), { tone: "lo" }));
  out.push(topText([tag.x + 4, tag.y + 2.5], BENCH_H + 11.1, "ctx",
    { size: 2.6, anchor: "middle", tone: "hi" }));
  out.push(nameplate(-56, 26, 62, "context-pack"));
  out.push(faceText([-52, FY, BENCH_H * 0.55], "PACK"));
  return out.join("");
}

// ---------- project-memory: lemari katalog + kaca pembesar ----------
function catalog() {
  const out = [];
  out.push(S(k.slabOf(CAB, BENCH_H, CAB_H, P, 4, 0.8), { tone: "mid" }));
  const yf = CAB.y + CAB.d;
  // grid laci di muka depan: 2 kolom x 3 baris — seam + bingkai label + knob
  const colW = (CAB.w - 10) / 2;
  for (let c = 0; c < 2; c++) {
    for (let r = 0; r < 3; r++) {
      const x0 = CAB.x + 5 + c * colW;
      const z0 = BENCH_H + 5 + r * 13;
      // seam persegi laci
      out.push(L(k.pathOf([
        at([x0, yf + 0.3, z0]), at([x0 + colW - 4, yf + 0.3, z0]),
        at([x0 + colW - 4, yf + 0.3, z0 + 11]), at([x0, yf + 0.3, z0 + 11]),
      ], true), { tone: "faint" }));
      // bingkai label
      out.push(L(k.pathOf([
        at([x0 + 3, yf + 0.4, z0 + 6.5]), at([x0 + 10, yf + 0.4, z0 + 6.5]),
        at([x0 + 10, yf + 0.4, z0 + 9]), at([x0 + 3, yf + 0.4, z0 + 9]),
      ], true), { tone: "mid" }));
      // knob
      out.push(S(k.cylinder(x0 + colW / 2 + 3, yf, 1.4, z0 + 4.2, 1.8, P, 10), { tone: "hi" }));
    }
  }
  // satu laci terbuka: kotak menonjol + 3 kartu menjulang
  const d = DRAWER;
  out.push(S(k.slabOf(d, BENCH_H + 8, 9, P, 2, 0.4), { tone: "hi" }));
  for (let i = 0; i < 3; i++) {
    const card = { x: d.x + 3 + i * 5.5, y: d.y + 2, w: 4, d: 7, r: 0.4 };
    out.push(S(k.slabOf(card, BENCH_H + 17, 5.5 - i * 0.8, P, 1), { tone: i === 0 ? "lit" : "hi" }));
  }
  // kaca pembesar: lengan dua segmen dari pojok atas lemari, lensa datar
  // mengambang di atas laci terbuka
  const ax = CAB.x + CAB.w - 6, ay = CAB.y + 6, az = BENCH_H + CAB_H;
  out.push(S(k.cylinder(ax, ay, 2.2, az, 3, P, 12), { tone: "mid" }));
  const jx = ax + 6, jy = ay + 12, jz = az + 12;
  out.push(seg([ax, ay, az + 3], [jx, jy, jz], 1.4, "mid"));
  out.push(Dt([at([jx, jy, jz])], { size: 0.9, tone: "hi" }));
  const lx = d.x + 10, ly = d.y + d.d / 2, lz = BENCH_H + 30;
  out.push(seg([jx, jy, jz], [lx, ly - 6, lz + 2], 1.2, "mid"));
  // lensa: cincin horizontal + ring dalam + sumbu kecil di tepi
  out.push(L(k.ring(lx, ly, 8, lz, P, 30), { tone: "hi" }));
  out.push(L(k.ring(lx, ly, 5.8, lz, P, 30), { tone: "faint" }));
  out.push(Dt([at([lx, ly, lz])], { size: 0.7, tone: "lit" }));
  // berkas cahaya ke kartu di laci (garis putus tipis)
  for (const [tx, tz] of [[d.x + 5, BENCH_H + 21], [d.x + 15, BENCH_H + 20]])
    out.push(`<path class="iso-line" data-tone="faint" style="stroke-dasharray:1.6 2.4" d="${k.pathOf([
      at([lx, ly, lz - 0.5]), at([tx, d.y + d.d, tz])])}"/>`);
  out.push(nameplate(32, 18, 66, "project-memory"));
  out.push(faceText([33, FY, BENCH_H * 0.55], "MEMORY"));
  return out.join("");
}

// ---------- checkpoint: rak canister rol ----------
function checkpoint() {
  const out = [];
  // rak: nampan belakang + bibir depan rendah
  out.push(S(k.slabOf(RACK, BENCH_H + 2, 2.2, P, 3, 0.5), { tone: "lo" }));
  out.push(L(k.planOutline(RACK, BENCH_H + 6, P), { tone: "mid" }));
  for (const [x, y] of [[RACK.x, RACK.y + RACK.d], [RACK.x + RACK.w, RACK.y + RACK.d]])
    out.push(S(k.cylinder(x, y, 1.0, BENCH_H + 4, 2, P, 8), { tone: "mid" }));
  // canister rol berdiri di rak
  for (const c of REELS) {
    const cx = c.x + 6, cy = RACK.y + RACK.d / 2;
    out.push(S(k.cylinder(cx, cy, 6, BENCH_H + 4, c.h, P, 22), { tone: "mid" }));
    out.push(L(k.ring(cx, cy, 6, BENCH_H + 4 + c.h, P, 22), { tone: "hi" }));
    out.push(L(k.ring(cx, cy, 3.4, BENCH_H + 4 + c.h, P, 18), { tone: "faint" }));
    out.push(Dt([at([cx, cy, BENCH_H + 4 + c.h])], { size: 0.5 }));
    out.push(topText([cx, cy], BENCH_H + 4 + c.h + 0.8, c.tag,
      { size: 2.8, anchor: "middle", tone: "hi" }));
    // jahitan pita di sisi depan tiap canister
    out.push(L(k.pathOf([
      at([cx - 6, cy + 6.01, BENCH_H + 6]), at([cx + 6, cy + 6.01, BENCH_H + 6])]),
      { tone: "faint" }));
  }
  // pita lepas dari canister terdepan: tiga lembar turun bertingkat ke depan
  for (let i = 0; i < 3; i++) {
    const s = { x: REELS[1].x + 2 + i * 6, y: RACK.y + RACK.d + 2 + i * 8, w: 10, d: 8, r: 0.6 };
    out.push(S(k.slabOf(s, BENCH_H + 0.4 + (2 - i) * 1.1, 0.9, P, 2), { tone: "hi" }));
  }
  // tuas rewind di sisi kanan rak
  const cx0 = RACK.x + RACK.w + 4, cy0 = RACK.y + RACK.d / 2;
  out.push(S(k.cylinder(cx0, cy0, 2.6, BENCH_H + 8, 3, P, 12), { tone: "mid" }));
  out.push(seg([cx0, cy0, BENCH_H + 11], [cx0 + 5, cy0, BENCH_H + 15], 1.2, "hi"));
  out.push(S(k.cylinder(cx0 + 6, cy0, 1.5, BENCH_H + 13, 3.4, P, 10), { tone: "hi" }));
  out.push(nameplate(128, 10, 56, "checkpoint"));
  out.push(faceText([129, FY, BENCH_H * 0.55], "SNAPSHOT"));
  return out.join("");
}

// ---------- alur: press -> laci katalog (tabung bundel) ----------
function tube() {
  const out = [];
  const zT = BENCH_H + 24;
  const x0 = POST_R.x + 3, y0 = POST_R.y + 3;
  const x1 = CAB.x + 10, y1 = CAB.y + 4;
  out.push(seg([x0, y0, zT], [x1, y0, zT]));
  out.push(S(k.cylinder(x1, y0, 2.6, zT - 3, 6, P, 16), { tone: "mid" }));
  out.push(seg([x1, y0, zT], [x1, y1, zT]));
  out.push(seg([x1, y1, zT], [x1, y1, BENCH_H + CAB_H + 3]));
  out.push(S(k.cylinder(x1, y1, 2.8, BENCH_H + CAB_H - 1, 4, P, 16), { tone: "mid" }));
  // kapsul bundel di tengah segmen pertama (aksen lit — benda bergerak)
  const cx = x0 + 14;
  out.push(S(k.cylinder(cx, y0, 2.2, zT - 1.1, 2.2, P, 14), { tone: "hi", lit: true }));
  out.push(S(k.cylinder(cx - 3.8, y0, 1.8, zT - 0.9, 1.8, P, 14), { tone: "mid" }));
  out.push(S(k.cylinder(cx + 3.8, y0, 1.8, zT - 0.9, 1.8, P, 14), { tone: "mid" }));
  // kabel arsip: katalog -> rak canister
  out.push(k.wireSvg(
    at([CAB.x + CAB.w, CAB.y + 4, BENCH_H + CAB_H - 6]),
    at([RACK.x, RACK.y + 4, BENCH_H + 10]),
    { via: [at([CAB.x + CAB.w + 16, CAB.y - 14, BENCH_H + 40])], tone: "lo", size: 0.9 }));
  return out.join("");
}

const body = [bench(), journal(), press(), catalog(), tube(), checkpoint()];

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  standalone: true,
  className: LIGHT ? " light" : "",
  label:
    "dev-mcp-suite by MaximaLabs — The Recall Bench. Kiri: slip sesi masuk baki dan jurnal DEVJOURNAL menuliskannya (buku terbuka, pena, pita pembatas). Tengah: pres CONTEXT-PACK menekan tumpukan konteks jadi bundel berlabel ctx yang naik lewat tabung. Kanan: lemari kartu PROJECT-MEMORY dengan satu laci terbuka dan lengan kaca pembesar, plus rak canister CHECKPOINT berisi rol titik-pulih r1–r4.",
  body,
});

const file = LIGHT ? "devmcp-flow-light.svg" : "devmcp-flow.svg";
const themed = LIGHT ? svg.replace('data-theme="true"', 'data-theme="light"') : svg;
writeFileSync(join(HERE, file), themed);
console.log("wrote", file, themed.length, "bytes");
