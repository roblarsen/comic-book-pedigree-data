import * as fs from 'node:fs';
import * as path from 'node:path';
import { ComicArtPage, formatSurvivalStatus, parseComicArtPages } from './types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStatusClass(status: ComicArtPage['survivalStatus']): string {
  switch (status) {
    case 'verified':
      return 'status-verified';
    case 'complete_intact':
      return 'status-complete-intact';
    case 'dispersed':
      return 'status-dispersed';
    case 'unconfirmed':
      return 'status-unconfirmed';
    default:
      return '';
  }
}

function generateReadonlyHtml(data: ComicArtPage[]): string {
  const sorted = [...data].sort((a, b) => {
    const titleCmp = a.publicationTarget.seriesTitle.localeCompare(b.publicationTarget.seriesTitle);
    if (titleCmp !== 0) return titleCmp;
    return a.publicationTarget.issueNumber - b.publicationTarget.issueNumber;
  });

  const rows = sorted
    .map((entry) => {
      const isUnconfirmed = entry.survivalStatus === 'unconfirmed';
      const statusClass = getStatusClass(entry.survivalStatus);
      const provenanceItems = entry.provenanceLedger
        .map((event) => {
          const label = event.notes ?? `${event.eventType} (${event.date})`;
          if (event.sourceLink) {
            return `<li><a href="${escapeHtml(event.sourceLink)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></li>`;
          }
          return `<li>${escapeHtml(label)}</li>`;
        })
        .join('\n            ');

      const provenanceHtml = provenanceItems
        ? `<ul class="silver-age-art-link-list">\n            ${provenanceItems}\n          </ul>`
        : '';

      const seriesTitle = escapeHtml(entry.publicationTarget.seriesTitle);
      const issueNumber = escapeHtml(String(entry.publicationTarget.issueNumber));
      const pages = escapeHtml(entry.publicationTarget.storyPageNumbers.join(', '));
      const description = escapeHtml(entry.generalCommentary ?? '');
      const artists = escapeHtml(entry.artDetails.creators.map((creator) => creator.name).join(', '));
      const statusText = escapeHtml(formatSurvivalStatus(entry.survivalStatus));

      return `<tr${isUnconfirmed ? ' class="silver-age-art-ghost-row"' : ''}>
        <td><strong>${seriesTitle}</strong></td>
        <td>#${issueNumber}</td>
        <td>${pages}</td>
        <td><span class="silver-age-art-status-tag ${statusClass}">${statusText}</span></td>
        <td>${description}</td>
        <td>${artists}</td>
        <td>
          ${provenanceHtml}
        </td>
      </tr>`;
    })
    .join('\n  ');

  return `<!-- Silver Age Marvel Original Comic Art Census & Provenance Table -->
<style>
  .silver-age-art-census-container {
    width: 100%;
    overflow-x: auto;
    margin: 20px 0;
  }
  .silver-age-art-census-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 13.5px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .silver-age-art-census-table th,
  .silver-age-art-census-table td {
    padding: 10px 14px;
    border: 1px solid #e0e0e0;
    vertical-align: top;
  }
  .silver-age-art-census-table th {
    background-color: #f5f5f7;
    font-weight: 600;
    color: #1d1d1f;
    white-space: nowrap;
    font-size: 12px;
  }
  .silver-age-art-census-table tr:nth-child(even) {
    background-color: #fafafc;
  }
  .silver-age-art-census-table tr.silver-age-art-ghost-row {
    background-color: #fff8f8;
    color: #666;
  }
  .silver-age-art-status-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .status-verified { background-color: #e3f2fd; color: #0d47a1; }
  .status-complete-intact { background-color: #dcfce7; color: #15803d; }
  .status-dispersed { background-color: #fef08a; color: #854d0e; }
  .status-unconfirmed { background-color: #ffebee; color: #b71c1c; }
  
  .silver-age-art-census-table a {
    color: #0066cc;
    text-decoration: none;
    word-break: break-all;
  }
  .silver-age-art-census-table a:hover {
    text-decoration: underline;
  }
  .silver-age-art-link-list {
    margin: 0;
    padding-left: 18px;
  }
  .silver-age-art-link-list li {
    margin-bottom: 4px;
  }
</style>

<div class="silver-age-art-census-container">
  <table class="silver-age-art-census-table">
    <thead>
      <tr>
        <th>Title</th>
        <th>Issue</th>
        <th>Pages</th>
        <th>Status</th>
        <th>Description / Survivor Details</th>
        <th>Artist(s)</th>
        <th>Provenance / Documentation / Links</th>
      </tr>
    </thead>
    <tbody>
  ${rows}
    </tbody>
  </table>
</div>

<!-- End Silver Age Marvel Original Comic Art Census & Provenance Table -->`;
}

function run(): void {
  const rootDir = process.cwd();
  const dataFilePath = path.join(rootDir, 'data.json');
  const distDir = path.join(rootDir, 'dist');
  const outputFilePath = path.join(distDir, 'dist.html');

  if (!fs.existsSync(dataFilePath)) {
    console.error(`Error: Could not find ${dataFilePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(dataFilePath, 'utf-8');
  const data = parseComicArtPages(JSON.parse(raw));

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const html = generateReadonlyHtml(data);
  fs.writeFileSync(outputFilePath, html, 'utf-8');
  console.log(`✓ WordPress-compatible HTML fragment successfully built: ${outputFilePath} (${data.length} records)`);
}

run();
