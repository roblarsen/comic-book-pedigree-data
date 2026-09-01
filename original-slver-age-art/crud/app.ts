import { ArtCensusEntry, ArtStatus, ProvenanceRecord } from './types.js';

const UNDO_STACK_KEY = 'silver_age_census_undo_stack';
const MAX_UNDO_DEPTH = 30;

class CensusApp {
  private data: ArtCensusEntry[] = [];
  private fileHandle: FileSystemFileHandle | null = null;
  private searchQuery: string = '';
  private statusFilter: string = '';
  private undoStack: ArtCensusEntry[][] = [];

  constructor() {
    this.initUndoStack();
    this.bindEvents();
    this.render();
  }

  // ==========================
  // File System Access API
  // ==========================
  private async openFile(): Promise<void> {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
        multiple: false,
      });

      this.fileHandle = handle;
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (Array.isArray(parsed)) {
        this.data = parsed;
        this.undoStack = [];
        this.saveUndoStack();
        this.updateFileStatusBadge(file.name);
        this.render();
      } else {
        alert('Invalid format: Root of JSON must be an array.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('File Open Error:', err);
        alert('Could not open file: ' + err.message);
      }
    }
  }

  private async syncToDisk(): Promise<void> {
    if (!this.fileHandle) {
      alert('No file currently linked. Please click "Open / Link Local File" to choose your data.json.');
      return;
    }

    try {
      const writableStream = await (this.fileHandle as any).createWritable();
      const sortedData = this.sortData(this.data);
      const content = JSON.stringify(sortedData, null, 2);
      await writableStream.write(content);
      await writableStream.close();
      this.flashSaveIndicator();
    } catch (err: any) {
      console.error('File Write Error:', err);
      alert('Error writing directly to file: ' + err.message);
    }
  }

  // ==========================
  // Undo Management (LocalStorage)
  // ==========================
  private initUndoStack(): void {
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    if (raw) {
      try {
        this.undoStack = JSON.parse(raw);
      } catch {
        this.undoStack = [];
      }
    }
  }

  private pushUndoState(): void {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_UNDO_DEPTH) {
      this.undoStack.shift();
    }
    this.saveUndoStack();
    this.updateUndoButton();
  }

  private saveUndoStack(): void {
    localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(this.undoStack));
  }

  private async undo(): Promise<void> {
    if (this.undoStack.length === 0) return;
    const previous = this.undoStack.pop();
    if (previous) {
      this.data = previous;
      this.saveUndoStack();
      this.updateUndoButton();
      await this.syncToDisk();
      this.render();
    }
  }

  private updateUndoButton(): void {
    const btn = document.getElementById('undo-btn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = this.undoStack.length === 0;
      btn.textContent = `Undo (${this.undoStack.length})`;
    }
  }

  // ==========================
  // Operations & CRUD
  // ==========================
  private sortData(entries: ArtCensusEntry[]): ArtCensusEntry[] {
    return [...entries].sort((a, b) => {
      const titleCmp = a.seriesTitle.localeCompare(b.seriesTitle);
      if (titleCmp !== 0) return titleCmp;
      const numA = a.issueNumbers[0] ?? 0;
      const numB = b.issueNumbers[0] ?? 0;
      return numA - numB;
    });
  }

  private async handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const id = (document.getElementById('entry-id') as HTMLInputElement).value;
    const seriesTitle = (document.getElementById('seriesTitle') as HTMLInputElement).value.trim();
    const issueDisplay = (document.getElementById('issueDisplay') as HTMLInputElement).value.trim();
    const issueNumsRaw = (document.getElementById('issueNumbers') as HTMLInputElement).value;
    const status = (document.getElementById('status') as HTMLSelectElement).value as ArtStatus;
    const artistsRaw = (document.getElementById('artists') as HTMLInputElement).value;
    const description = (document.getElementById('description') as HTMLTextAreaElement).value.trim();
    const provRaw = (document.getElementById('provenance') as HTMLTextAreaElement).value;

    const issueNumbers = issueNumsRaw
      .split(',')
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n));

    const artists = artistsRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const provenance: ProvenanceRecord[] = provRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|').map((s) => s.trim());
        if (parts.length >= 2) {
          return { label: parts[0], url: parts.slice(1).join('|') };
        }
        return { label: parts[0] };
      });

    const entryId = id || this.slugify(`${seriesTitle}-${issueDisplay}`);

    const newEntry: ArtCensusEntry = {
      id: entryId,
      seriesTitle,
      issueDisplay,
      issueNumbers,
      status,
      artists,
      description,
      provenance,
    };

    this.pushUndoState();

    if (id) {
      const idx = this.data.findIndex((item) => item.id === id);
      if (idx !== -1) this.data[idx] = newEntry;
    } else {
      this.data.push(newEntry);
    }

    await this.syncToDisk();
    this.closeModal();
    this.render();
  }

  private async deleteEntry(id: string): Promise<void> {
    const target = this.data.find((e) => e.id === id);
    if (!target) return;
    if (confirm(`Delete ${target.seriesTitle} ${target.issueDisplay}?`)) {
      this.pushUndoState();
      this.data = this.data.filter((e) => e.id !== id);
      await this.syncToDisk();
      this.render();
    }
  }

  // ==========================
  // UI & Event Bindings
  // ==========================
  private bindEvents(): void {
    const openBtn = document.getElementById('open-file-btn') as HTMLButtonElement;
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const statusFilter = document.getElementById('status-filter') as HTMLSelectElement;
    const addBtn = document.getElementById('add-btn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
    const form = document.getElementById('census-form') as HTMLFormElement;

    openBtn.addEventListener('click', () => this.openFile());
    undoBtn.addEventListener('click', () => this.undo());
    addBtn.addEventListener('click', () => this.openModal());
    cancelBtn.addEventListener('click', () => this.closeModal());
    form.addEventListener('submit', (e) => this.handleFormSubmit(e));

    searchInput.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.render();
    });

    statusFilter.addEventListener('change', (e) => {
      this.statusFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Prevent default undo if not typing in an input/textarea
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          this.undo();
        }
      }
    });

    this.updateUndoButton();
  }

  private updateFileStatusBadge(filename: string): void {
    const badge = document.getElementById('file-status') as HTMLElement;
    if (badge) {
      badge.textContent = `📁 Linked: ${filename}`;
      badge.style.color = '#15803d';
      badge.style.borderColor = '#86efac';
    }
  }

  private flashSaveIndicator(): void {
    const indicator = document.getElementById('save-indicator') as HTMLElement;
    if (indicator) {
      indicator.style.opacity = '1';
      setTimeout(() => {
        indicator.style.opacity = '0';
      }, 1500);
    }
  }

  private render(): void {
    const tbody = document.getElementById('census-table-body') as HTMLTableSectionElement;
    tbody.innerHTML = '';

    const filtered = this.sortData(this.data).filter((item) => {
      const matchesStatus = !this.statusFilter || item.status === this.statusFilter;
      const matchesSearch =
        !this.searchQuery ||
        item.seriesTitle.toLowerCase().includes(this.searchQuery) ||
        item.issueDisplay.toLowerCase().includes(this.searchQuery) ||
        item.artists.some((a: string) => a.toLowerCase().includes(this.searchQuery)) ||
        item.description.toLowerCase().includes(this.searchQuery);

      return matchesStatus && matchesSearch;
    });

    filtered.forEach((entry) => {
      const tr = document.createElement('tr');
      if (entry.status === 'Ghost') tr.classList.add('ghost-row');

      const statusClass = `status-${entry.status.replace(/\s+/g, '-')}`;

      const provenanceHtml = entry.provenance
        .map((p: ProvenanceRecord) => {
          if (p.url) {
            return `<li><a href="${this.escapeHtml(p.url)}" target="_blank" rel="noopener">${this.escapeHtml(p.label)}</a></li>`;
          }
          return `<li>${this.escapeHtml(p.label)}</li>`;
        })
        .join('');

      tr.innerHTML = `
        <td>
          <strong>${this.escapeHtml(entry.seriesTitle)}</strong><br />
          <span style="color: var(--muted);">${this.escapeHtml(entry.issueDisplay)}</span>
        </td>
        <td><span class="status-tag ${statusClass}">${this.escapeHtml(entry.status)}</span></td>
        <td>${this.escapeHtml(entry.artists.join(', '))}</td>
        <td>${this.escapeHtml(entry.description)}</td>
        <td><ul class="provenance-links">${provenanceHtml}</ul></td>
        <td>
          <div class="actions">
            <button class="secondary" data-action="edit" data-id="${entry.id}">Edit</button>
            <button class="danger" data-action="delete" data-id="${entry.id}">Delete</button>
          </div>
        </td>
      `;

      tr.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.openModal(entry));
      tr.querySelector('[data-action="delete"]')?.addEventListener('click', () => this.deleteEntry(entry.id));

      tbody.appendChild(tr);
    });
  }

  private openModal(entry?: ArtCensusEntry): void {
    const backdrop = document.getElementById('modal-backdrop') as HTMLDivElement;
    const title = document.getElementById('modal-title') as HTMLHeadingElement;
    const form = document.getElementById('census-form') as HTMLFormElement;

    form.reset();

    if (entry) {
      title.textContent = `Edit ${entry.seriesTitle} ${entry.issueDisplay}`;
      (document.getElementById('entry-id') as HTMLInputElement).value = entry.id;
      (document.getElementById('seriesTitle') as HTMLInputElement).value = entry.seriesTitle;
      (document.getElementById('issueDisplay') as HTMLInputElement).value = entry.issueDisplay;
      (document.getElementById('issueNumbers') as HTMLInputElement).value = entry.issueNumbers.join(', ');
      (document.getElementById('status') as HTMLSelectElement).value = entry.status;
      (document.getElementById('artists') as HTMLInputElement).value = entry.artists.join(', ');
      (document.getElementById('description') as HTMLTextAreaElement).value = entry.description;

      const provLines = entry.provenance
        .map((p: ProvenanceRecord) => (p.url ? `${p.label} | ${p.url}` : p.label))
        .join('\n');
      (document.getElementById('provenance') as HTMLTextAreaElement).value = provLines;
    } else {
      title.textContent = 'Add New Entry';
      (document.getElementById('entry-id') as HTMLInputElement).value = '';
    }

    backdrop.classList.add('open');
  }

  private closeModal(): void {
    const backdrop = document.getElementById('modal-backdrop') as HTMLDivElement;
    backdrop.classList.remove('open');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new CensusApp();
});