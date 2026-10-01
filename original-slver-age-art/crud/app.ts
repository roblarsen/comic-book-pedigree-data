import {
  ComicArtPage,
  ProvenanceEvent,
  PROVENANCE_EVENT_TYPES,
  SurvivalStatus,
  createProvenanceEventId,
  formatSurvivalStatus,
  parseComicArtPages,
  sanitizeProvenanceLedger,
} from './types.js';

const UNDO_STACK_KEY = 'silver_age_census_undo_stack';
const MAX_UNDO_DEPTH = 30;
const SCHEMA_VERSION = '1.1.0';
const DEFAULT_PUBLISHER = 'Marvel Comics';

class CensusApp {
  private data: ComicArtPage[] = [];
  private searchQuery: string = '';
  private statusFilter: string = '';
  private undoStack: ComicArtPage[][] = [];

  constructor() {
    this.initUndoStack();
    this.bindEvents();
    this.render();
    void this.loadData();
  }

  // ==========================
  // Data Loading & Saving
  // ==========================
  private async loadData(): Promise<void> {
    try {
      const response = await fetch('data.json');
      if (!response.ok) {
        throw new Error(`Could not load data.json (${response.status})`);
      }

      this.data = parseComicArtPages(await response.json());
      this.undoStack = [];
      this.saveUndoStack();
      this.updateFileStatusBadge('data.json');
      this.render();
    } catch (err: any) {
      console.error('Data Load Error:', err);
      this.updateFileStatusBadge('Unable to load data.json', true);
      alert('Could not load data.json: ' + err.message);
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const sortedData = this.sortData(this.data).map((entry) => this.normalizeEntryForPersistence(entry));
      const content = JSON.stringify(sortedData, null, 2);

      const savedToRepo = await this.saveToRepository(content);
      if (savedToRepo) {
        this.flashSaveIndicator('Saved data.json');
      } else {
        this.downloadDataFile(content);
        this.flashSaveIndicator('Downloaded data.json');
      }
    } catch (err: any) {
      console.error('Data Save Error:', err);
      alert('Could not save data.json: ' + err.message);
    }
  }

  private async saveToRepository(content: string): Promise<boolean> {
    try {
      const response = await fetch('/__save_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private downloadDataFile(content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'data.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ==========================
  // Undo Management (LocalStorage)
  // ==========================
  private initUndoStack(): void {
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.undoStack = parsed.map((snapshot) => parseComicArtPages(snapshot));
        } else {
          this.undoStack = [];
        }
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
  private sortData(entries: ComicArtPage[]): ComicArtPage[] {
    return [...entries].sort((a, b) => {
      const titleCmp = a.publicationTarget.seriesTitle.localeCompare(b.publicationTarget.seriesTitle);
      if (titleCmp !== 0) return titleCmp;
      return a.publicationTarget.issueNumber - b.publicationTarget.issueNumber;
    });
  }

  private async handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const urn = (document.getElementById('entry-id') as HTMLInputElement).value;
    const seriesTitle = (document.getElementById('seriesTitle') as HTMLInputElement).value.trim();
    const issueNumberRaw = (document.getElementById('issueNumber') as HTMLInputElement).value.trim();
    const storyPageNumbersRaw = (document.getElementById('storyPageNumbers') as HTMLInputElement).value;
    const status = (document.getElementById('status') as HTMLSelectElement).value as SurvivalStatus;
    const workType = (document.getElementById('workType') as HTMLSelectElement)
      .value as ComicArtPage['artDetails']['workType'];
    const artistsRaw = (document.getElementById('artists') as HTMLInputElement).value;
    const description = (document.getElementById('description') as HTMLTextAreaElement).value.trim();
    const isBackupStory = (document.getElementById('isBackupStory') as HTMLInputElement).checked;

    const issueNumber = Number.parseInt(issueNumberRaw, 10);
    if (Number.isNaN(issueNumber)) {
      alert('Issue Number must be a valid number.');
      return;
    }

    const storyPageNumbers = storyPageNumbersRaw
      .split(',')
      .map((n) => Number.parseInt(n.trim(), 10))
      .filter((n) => !Number.isNaN(n));

    const creators = artistsRaw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((name) => ({ name, role: 'pencils_and_inks' as const }));

    const entryUrn = urn || this.createUrn(seriesTitle, issueNumber);

    const newEntry: ComicArtPage = {
      urn: entryUrn,
      schemaVersion: SCHEMA_VERSION,
      assetClass: 'original_art',
      publicationTarget: {
        publisher: DEFAULT_PUBLISHER,
        seriesTitle,
        issueNumber,
        storyPageNumbers: storyPageNumbers.length > 0 ? storyPageNumbers : [1],
        isBackupStory: isBackupStory || undefined,
      },
      artDetails: {
        workType,
        creators,
      },
      survivalStatus: status,
      generalCommentary: description || undefined,
      provenanceLedger: this.readProvenanceEventsFromForm(entryUrn, status),
      customMetadata: {},
    };

    this.pushUndoState();

    if (urn) {
      const idx = this.data.findIndex((item) => item.urn === urn);
      if (idx !== -1) this.data[idx] = newEntry;
    } else {
      this.data.push(newEntry);
    }

    await this.syncToDisk();
    this.closeModal();
    this.render();
  }

  private async deleteEntry(urn: string): Promise<void> {
    const target = this.data.find((e) => e.urn === urn);
    if (!target) return;

    const title = target.publicationTarget.seriesTitle;
    const issue = target.publicationTarget.issueNumber;

    if (confirm(`Delete ${title} #${issue}?`)) {
      this.pushUndoState();
      this.data = this.data.filter((e) => e.urn !== urn);
      await this.syncToDisk();
      this.render();
    }
  }

  // ==========================
  // UI & Event Bindings
  // ==========================
  private bindEvents(): void {
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const statusFilter = document.getElementById('status-filter') as HTMLSelectElement;
    const addBtn = document.getElementById('add-btn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
    const form = document.getElementById('census-form') as HTMLFormElement;
    const statusSelect = document.getElementById('status') as HTMLSelectElement;
    const addProvenanceBtn = document.getElementById('add-provenance-event-btn') as HTMLButtonElement;
    const provenanceEvents = document.getElementById('provenance-events') as HTMLDivElement;

    undoBtn.addEventListener('click', () => this.undo());
    addBtn.addEventListener('click', () => this.openModal());
    cancelBtn.addEventListener('click', () => this.closeModal());
    form.addEventListener('submit', (e) => this.handleFormSubmit(e));
    statusSelect.addEventListener('change', () => this.handleStatusChange());
    addProvenanceBtn.addEventListener('click', () => this.addProvenanceEventRow());
    provenanceEvents.addEventListener('click', (event) => this.handleProvenanceRowActions(event));

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
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          this.undo();
        }
      }
    });

    this.updateUndoButton();
  }

  private updateFileStatusBadge(filename: string, isError = false): void {
    const badge = document.getElementById('file-status') as HTMLElement;
    if (badge) {
      badge.textContent = isError ? filename : `Loaded: ${filename}`;
      badge.style.color = isError ? '#b91c1c' : '#15803d';
      badge.style.borderColor = isError ? '#fecaca' : '#86efac';
    }
  }

  private flashSaveIndicator(message: string): void {
    const indicator = document.getElementById('save-indicator') as HTMLElement;
    if (indicator) {
      indicator.textContent = message;
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
      const matchesStatus = !this.statusFilter || item.survivalStatus === this.statusFilter;
      const pageLabel = item.publicationTarget.storyPageNumbers.join(', ');
      const matchesSearch =
        !this.searchQuery ||
        item.publicationTarget.seriesTitle.toLowerCase().includes(this.searchQuery) ||
        String(item.publicationTarget.issueNumber).includes(this.searchQuery) ||
        pageLabel.toLowerCase().includes(this.searchQuery) ||
        item.artDetails.creators.some((creator) => creator.name.toLowerCase().includes(this.searchQuery)) ||
        (item.generalCommentary ?? '').toLowerCase().includes(this.searchQuery);

      return matchesStatus && matchesSearch;
    });

    filtered.forEach((entry) => {
      const tr = document.createElement('tr');
      if (entry.survivalStatus === 'unconfirmed') tr.classList.add('ghost-row');

      const statusClass = `status-${entry.survivalStatus.replace(/_/g, '-')}`;
      const series = entry.publicationTarget.seriesTitle;
      const issue = `#${entry.publicationTarget.issueNumber}`;
      const pageNumbers = entry.publicationTarget.storyPageNumbers.join(', ');
      const statusText = formatSurvivalStatus(entry.survivalStatus);

      const provenanceHtml = entry.provenanceLedger
        .map((event) => {
          const label = event.notes ?? `${event.eventType} (${event.date})`;
          if (event.sourceLink) {
            return `<li><a href="${this.escapeHtml(event.sourceLink)}" target="_blank" rel="noopener">${this.escapeHtml(label)}</a></li>`;
          }
          return `<li>${this.escapeHtml(label)}</li>`;
        })
        .join('');

      tr.innerHTML = `
        <td>
          <strong>${this.escapeHtml(series)}</strong><br />
          <span style="color: var(--muted);">${this.escapeHtml(issue)} • Pages ${this.escapeHtml(pageNumbers)}</span>
        </td>
        <td><span class="status-tag ${statusClass}">${this.escapeHtml(statusText)}</span></td>
        <td>${this.escapeHtml(entry.artDetails.creators.map((creator) => creator.name).join(', '))}</td>
        <td>${this.escapeHtml(entry.generalCommentary ?? '')}</td>
        <td><ul class="provenance-links">${provenanceHtml}</ul></td>
        <td>
          <div class="actions">
            <button class="secondary" data-action="edit" data-id="${entry.urn}">Edit</button>
            <button class="danger" data-action="delete" data-id="${entry.urn}">Delete</button>
          </div>
        </td>
      `;

      tr.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.openModal(entry));
      tr.querySelector('[data-action="delete"]')?.addEventListener('click', () => this.deleteEntry(entry.urn));

      tbody.appendChild(tr);
    });
  }

  private normalizeEntryForPersistence(entry: ComicArtPage): ComicArtPage {
    return {
      ...entry,
      provenanceLedger: sanitizeProvenanceLedger(entry.provenanceLedger, entry.urn, entry.survivalStatus),
    };
  }

  private readProvenanceEventsFromForm(urn: string, status: SurvivalStatus): ProvenanceEvent[] {
    if (status === 'unconfirmed') {
      return [];
    }

    const rows = Array.from(document.querySelectorAll('.provenance-event-row'));
    const rawEvents = rows.map((row, index) => {
      const eventId = (row.querySelector('.provenance-event-id') as HTMLInputElement)?.value.trim();
      const eventType = (row.querySelector('.provenance-event-type') as HTMLSelectElement)?.value.trim();
      const date = (row.querySelector('.provenance-event-date') as HTMLInputElement)?.value.trim();
      const notes = (row.querySelector('.provenance-event-notes') as HTMLTextAreaElement)?.value.trim();
      const sourceLink = (row.querySelector('.provenance-event-source-link') as HTMLInputElement)?.value.trim();

      return {
        eventId: eventId || createProvenanceEventId(urn, index),
        eventType,
        date,
        notes,
        sourceLink,
      };
    });

    return sanitizeProvenanceLedger(rawEvents, urn, status);
  }

  private handleStatusChange(): void {
    const status = (document.getElementById('status') as HTMLSelectElement).value as SurvivalStatus;

    if (status === 'unconfirmed') {
      const provenanceEvents = document.getElementById('provenance-events') as HTMLDivElement;
      if (provenanceEvents.childElementCount > 0) {
        provenanceEvents.innerHTML = '';
      }
    }

    this.updateProvenanceEditorState();
  }

  private updateProvenanceEditorState(): void {
    const status = (document.getElementById('status') as HTMLSelectElement).value as SurvivalStatus;
    const editor = document.getElementById('provenance-editor') as HTMLDivElement;
    const helper = document.getElementById('provenance-unconfirmed-helper') as HTMLDivElement;
    const addBtn = document.getElementById('add-provenance-event-btn') as HTMLButtonElement;
    const controls = editor.querySelectorAll('input, select, textarea, button');
    const isUnconfirmed = status === 'unconfirmed';

    editor.classList.toggle('is-disabled', isUnconfirmed);
    addBtn.disabled = isUnconfirmed;
    helper.hidden = !isUnconfirmed;

    controls.forEach((control) => {
      const element = control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
      element.disabled = isUnconfirmed;
    });
  }

  private addProvenanceEventRow(event?: ProvenanceEvent): void {
    const urn = (document.getElementById('entry-id') as HTMLInputElement).value.trim();
    const seriesTitle = (document.getElementById('seriesTitle') as HTMLInputElement).value.trim();
    const issueNumberRaw = (document.getElementById('issueNumber') as HTMLInputElement).value.trim();
    const issueNumber = Number.parseInt(issueNumberRaw, 10);
    const fallbackUrn =
      urn || this.createUrn(seriesTitle || 'untitled', Number.isNaN(issueNumber) ? 1 : issueNumber);
    const eventsContainer = document.getElementById('provenance-events') as HTMLDivElement;
    const eventIndex = eventsContainer.children.length;
    const eventId = event?.eventId ?? createProvenanceEventId(fallbackUrn, eventIndex);
    const row = document.createElement('div');

    row.className = 'provenance-event-row';
    row.innerHTML = `
      <div class="provenance-event-grid">
        <label>Event ID
          <input class="provenance-event-id" type="text" value="${this.escapeHtml(eventId)}" readonly />
        </label>
        <label>Event Type
          <select class="provenance-event-type">
            ${PROVENANCE_EVENT_TYPES.map(
              (eventType) =>
                `<option value="${eventType}" ${(event?.eventType ?? 'auction') === eventType ? 'selected' : ''}>${eventType}</option>`
            ).join('')}
          </select>
        </label>
        <label>Date
          <input class="provenance-event-date" type="date" value="${this.escapeHtml(event?.date ?? '')}" />
        </label>
        <label>Source Link
          <input class="provenance-event-source-link" type="url" value="${this.escapeHtml(event?.sourceLink ?? '')}" />
        </label>
      </div>
      <label>Notes
        <textarea class="provenance-event-notes" rows="2">${this.escapeHtml(event?.notes ?? '')}</textarea>
      </label>
      <div class="provenance-event-actions">
        <button type="button" class="secondary" data-provenance-action="up">Move Up</button>
        <button type="button" class="secondary" data-provenance-action="down">Move Down</button>
        <button type="button" class="danger" data-provenance-action="remove">Remove Event</button>
      </div>
    `;

    eventsContainer.appendChild(row);
    this.renumberProvenanceEventIds();
    this.updateProvenanceEditorState();
  }

  private handleProvenanceRowActions(event: Event): void {
    const target = event.target as HTMLElement;
    const actionElement = target.closest('[data-provenance-action]') as HTMLElement | null;
    const action = actionElement?.getAttribute('data-provenance-action');
    if (!action || !actionElement) return;

    const row = actionElement.closest('.provenance-event-row') as HTMLDivElement | null;
    if (!row) return;

    if (action === 'remove') {
      row.remove();
    } else if (action === 'up') {
      const previous = row.previousElementSibling;
      if (previous) {
        row.parentElement?.insertBefore(row, previous);
      }
    } else if (action === 'down') {
      const next = row.nextElementSibling;
      if (next) {
        row.parentElement?.insertBefore(next, row);
      }
    }

    this.renumberProvenanceEventIds();
    this.updateProvenanceEditorState();
  }

  private renumberProvenanceEventIds(): void {
    const urn = (document.getElementById('entry-id') as HTMLInputElement).value.trim();
    const seriesTitle = (document.getElementById('seriesTitle') as HTMLInputElement).value.trim();
    const issueNumberRaw = (document.getElementById('issueNumber') as HTMLInputElement).value.trim();
    const issueNumber = Number.parseInt(issueNumberRaw, 10);
    const fallbackUrn =
      urn || this.createUrn(seriesTitle || 'untitled', Number.isNaN(issueNumber) ? 1 : issueNumber);
    const rows = Array.from(document.querySelectorAll('.provenance-event-row'));

    rows.forEach((row, index) => {
      const eventIdInput = row.querySelector('.provenance-event-id') as HTMLInputElement | null;
      if (eventIdInput) {
        eventIdInput.value = createProvenanceEventId(fallbackUrn, index);
      }
    });
  }

  private openModal(entry?: ComicArtPage): void {
    const backdrop = document.getElementById('modal-backdrop') as HTMLDivElement;
    const title = document.getElementById('modal-title') as HTMLHeadingElement;
    const form = document.getElementById('census-form') as HTMLFormElement;

    form.reset();
    const provenanceEvents = document.getElementById('provenance-events') as HTMLDivElement;
    provenanceEvents.innerHTML = '';

    if (entry) {
      const issue = entry.publicationTarget.issueNumber;
      title.textContent = `Edit ${entry.publicationTarget.seriesTitle} #${issue}`;
      (document.getElementById('entry-id') as HTMLInputElement).value = entry.urn;
      (document.getElementById('seriesTitle') as HTMLInputElement).value = entry.publicationTarget.seriesTitle;
      (document.getElementById('issueNumber') as HTMLInputElement).value = String(issue);
      (document.getElementById('storyPageNumbers') as HTMLInputElement).value =
        entry.publicationTarget.storyPageNumbers.join(', ');
      (document.getElementById('status') as HTMLSelectElement).value = entry.survivalStatus;
      (document.getElementById('workType') as HTMLSelectElement).value = entry.artDetails.workType;
      (document.getElementById('artists') as HTMLInputElement).value = entry.artDetails.creators
        .map((creator) => creator.name)
        .join(', ');
      (document.getElementById('description') as HTMLTextAreaElement).value = entry.generalCommentary ?? '';
      (document.getElementById('isBackupStory') as HTMLInputElement).checked =
        entry.publicationTarget.isBackupStory === true;
      entry.provenanceLedger.forEach((event) => this.addProvenanceEventRow(event));
    } else {
      title.textContent = 'Add New Entry';
      (document.getElementById('entry-id') as HTMLInputElement).value = '';
    }

    this.updateProvenanceEditorState();
    backdrop.classList.add('open');
  }

  private closeModal(): void {
    const backdrop = document.getElementById('modal-backdrop') as HTMLDivElement;
    backdrop.classList.remove('open');
  }

  private createUrn(seriesTitle: string, issueNumber: number): string {
    const slug = this.slugify(`${seriesTitle}-${issueNumber}`);
    return `urn:altasset:original_art:marvel-silver-age:${slug}:1`;
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
