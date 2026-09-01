import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtCensusEntry, ArtStatus } from './types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStatusClass(status: ArtStatus): string {
  switch (status) {
    case 'Verified':
      return 'status-verified';
    case 'Complete':
      return 'status-complete';
    case 'Backup Only':
      return 'status-backup';
    case 'Ghost':
      return 'status-ghost';
    default:
      return '';
  }
}

function generateStaticHtml(data: ArtCensusEntry[]): string {
  // Alphabetize by seriesTitle, then sort by first issue number
  const sorted = [...data].sort((a, b) => {
    const titleCmp = a.seriesTitle.localeCompare(b.seriesTitle);
    if (titleCmp !== 0) return titleCmp;
    const numA = a.issueNumbers[0] ?? 0;
    const numB = b.issueNumbers[0] ?? 0;
    return numA - numB;
  });

  const rows = sorted
    .map((entry) => {
      const isGhost = entry.status === 'Ghost';
      const statusClass = getStatusClass(entry.status);

      const provenanceItems = entry.provenance
        .map((p) => {
          if (p.url) {
            return `<li><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.label)}</a></li>`;
          }
          return `<li>${escapeHtml(p.label)}</li>`;
        })
        .join('\n            ');

      const provenanceHtml =
        entry.provenance.length === 1 && !entry.provenance[0].url
          ? escapeHtml(entry.provenance[0].label)
          : `<ul class="link-list">\n            ${provenanceItems}\n          </ul>`;

      return `
      <tr${isGhost ? ' class="ghost-row"' : ''}>
        <td><strong>${escapeHtml(entry.seriesTitle)}</strong></td>
        <td>${escapeHtml(entry.issueDisplay)}</td>
        <td><span class="status-tag ${statusClass}">${escapeHtml(entry.status)}</span></td>
        <td>${escapeHtml(entry.description)}</td>
        <td>${escapeHtml(entry.artists.join(', '))}</td>
        <td>
          ${provenanceHtml}
        </td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Silver Age Marvel Original Comic Art Master Census & Provenance</title>
<style>
  :root {
    --border: #e0e0e0;
    --bg-header: #f5f5f7;
    --bg-even: #fafafc;
    --link-color: #0066cc;
  }
  body {
    margin: 0;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1d1d1f;
    line-height: 1.5;
  }
  h1 {
    font-size: 1.5rem;
    margin-bottom: 8px;
  }
  .subtitle {
    font-size: 0.9rem;
    color: #6e6e73;
    margin-bottom: 24px;
  }
  .art-census-table-container {
    width: 100%;
    overflow-x: auto;
  }
  table.art-census-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 13.5px;
  }
  table.art-census-table th, 
  table.art-census-table td {
    padding: 10px 14px;
    border: 1px solid var(--border);
    vertical-align: top;
  }
  table.art-census-table th {
    background-color: var(--bg-header);
    font-weight: 600;
    color: #1d1d1f;
    white-space: nowrap;
  }
  table.art-census-table tr:nth-child(even) {
    background-color: var(--bg-even);
  }
  table.art-census-table tr.ghost-row {
    background-color: #fff8f8;
    color: #666;
  }
  .status-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .status-verified { background-color: #e3f2fd; color: #0d47a1; }
  .status-complete { background-color: #dcfce7; color: #15803d; }
  .status-backup { background-color: #fef08a; color: #854d0e; }
  .status-ghost { background-color: #ffebee; color: #b71c1c; }

  table.art-census-table a {
    color: var(--link-color);
    text-decoration: none;
    word-break: break-all;
  }
  table.art-census-table a:hover {
    text-decoration: underline;
  }
  .link-list {
    margin: 0;
    padding-left: 18px;
  }
  .link-list li {
    margin-bottom: 4px;
  }
</style>
</head>
<body>

<h1>Silver Age Marvel Original Comic Art Master Census &amp; Provenance</h1>
<div class="subtitle">Generated static build &bull; Physical Interior Production Art Tracking</div>

<div class="art-census-table-container">
  <table class="art-census-table">
    <thead>
      <tr>
        <th>Title</th>
        <th>Issue</th>
        <th>Status</th>
        <th>Description / Survivor Details</th>
        <th>Artist(s)</th>
        <th>Provenance / Documentation / Links</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</div>

</body>
</html>`;
}

function run(): void {
  const rootDir = process.cwd();
  const dataFilePath = path.join(rootDir, 'data.json');
  const distDir = path.join(rootDir, 'dist');
  const outputFilePath = path.join(distDir, 'static-table.html');

  if (!fs.existsSync(dataFilePath)) {
    console.error(`Error: Could not find ${dataFilePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(dataFilePath, 'utf-8');
  const data: ArtCensusEntry[] = JSON.parse(raw);

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const html = generateStaticHtml(data);
  fs.writeFileSync(outputFilePath, html, 'utf-8');
  console.log(`✓ Static HTML successfully built: ${outputFilePath} (${data.length} records)`);
}

run();