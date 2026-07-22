/**
 * Built-in Web GUI Dashboard Server for Dev MCP Suite (v3.0.0 God-Tier).
 * Zero external dependencies. Serves a glassmorphic dashboard on http://localhost:3333
 */

import http from "http";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { computeStats } from "./stats.js";

const DEFAULT_PORT = 3333;
const STORAGE_ROOT = path.join(os.homedir(), ".ai-shared-memory");

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dev MCP Suite — Peak Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: rgba(22, 27, 34, 0.75);
      --accent: #58a6ff;
      --accent-glow: rgba(88, 166, 255, 0.3);
      --text: #c9d1d9;
      --border: rgba(48, 54, 61, 0.8);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 20px; }
    header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
    h1 { color: #fff; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 20px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 20px; backdrop-filter: blur(10px); }
    .card h2 { font-size: 16px; color: var(--accent); margin-bottom: 15px; }
    canvas { width: 100%; height: 350px; background: #010409; border-radius: 8px; border: 1px solid var(--border); }
    ul { list-style: none; }
    li { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
    .badge { background: var(--accent-glow); color: var(--accent); padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <h1>🚀 Dev MCP Suite <span class="badge">v3.0.0 God-Tier</span></h1>
    <div>Local Storage: <code>~/.ai-shared-memory</code></div>
  </header>

  <div class="grid">
    <div class="card">
      <h2>🌌 3D/2D Knowledge Graph View</h2>
      <canvas id="graphCanvas"></canvas>
    </div>
    <div class="card">
      <h2>📊 Live Storage Stats</h2>
      <div id="statsBox">Loading stats...</div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('graphCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Animated node graph preview
    const nodes = Array.from({length: 12}, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      name: \`Note-\${i+1}\`
    }));

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw edges
      ctx.strokeStyle = 'rgba(88, 166, 255, 0.15)';
      ctx.lineWidth = 1;
      for(let i=0; i<nodes.length; i++) {
        for(let j=i+1; j<nodes.length; j++) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }

      // Draw nodes
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if(n.x < 10 || n.x > canvas.width - 10) n.vx *= -1;
        if(n.y < 10 || n.y > canvas.height - 10) n.vy *= -1;

        ctx.fillStyle = '#58a6ff';
        ctx.beginPath();
        ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#8b949e';
        ctx.font = '10px sans-serif';
        ctx.fillText(n.name, n.x + 10, n.y + 3);
      });

      requestAnimationFrame(draw);
    }
    draw();

    fetch('/api/stats')
      .then(r => r.json())
      .then(s => {
        document.getElementById('statsBox').innerHTML = \`
          <ul>
            <li><strong>Total Vault Notes:</strong> \${s.totalNotes || 0}</li>
            <li><strong>Journal Projects:</strong> \${s.totalJournalProjects || 0}</li>
            <li><strong>Checkpoints:</strong> \${s.totalCheckpoints || 0}</li>
          </ul>
        \`;
      }).catch(() => {
        document.getElementById('statsBox').innerHTML = "Ready";
      });
  </script>
</body>
</html>`;
}

export function startUiServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderHtml());

    } else if (req.url === "/api/stats") {
      const stats = computeStats({ root: STORAGE_ROOT });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));

    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(`\n🚀 [Dev MCP Suite UI] Web Dashboard running on http://localhost:${port}\n`);
  });

  return server;
}
