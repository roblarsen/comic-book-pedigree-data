const PEDIGREE_SOURCES = [
  {
    id: 'larson',
    label: 'Lamont Larson Collection',
    subtitle: 'Browse and filter pedigree CSV data.',
    fileName: './larson-list.csv',
  },
  {
    id: 'allentown',
    label: 'Allentown Pedigree',
    subtitle: 'Browse and filter pedigree CSV data.',
    fileName: '../dist/Allentown Pedigree.csv',
  },
];

const gridElement = document.getElementById('grid');
const quickFilterInput = document.getElementById('quick-filter');
const statusElement = document.getElementById('status');
const titleElement = document.getElementById('app-title');
const subtitleElement = document.getElementById('app-subtitle');
const pedigreeTabs = Array.from(document.querySelectorAll('[data-pedigree-tab]'));

let gridApi;
let activePedigree = PEDIGREE_SOURCES[0];
const pedigreeCache = new Map();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }

      row.push(value);
      value = '';

      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((cells) => {
    const record = {};

    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });

    return record;
  });

  return { headers, records };
}

function normalizeHeaderKey(header, index) {
  const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized || `column${index + 1}`;
}

function buildSchema(headers) {
  const usedKeys = new Set();

  return headers.map((header, index) => {
    const label = header.trim() || `Column ${index + 1}`;
    let field = normalizeHeaderKey(label, index);

    while (usedKeys.has(field)) {
      field = `${field}_${index + 1}`;
    }

    usedKeys.add(field);

    return {
      field,
      headerName: label,
      sourceHeader: header,
    };
  });
}

function buildRows(records, schema) {
  return records.map((record) => {
    const row = {};

    schema.forEach((column) => {
      row[column.field] = (record[column.sourceHeader] ?? '').trim();
    });

    return row;
  });
}

async function loadPedigreeData(fileName) {
  const cached = pedigreeCache.get(fileName);

  if (cached) {
    return cached;
  }

  const response = await fetch(fileName);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading CSV`);
  }

  const csvText = await response.text();
  const { headers, records } = parseCsv(csvText);

  if (headers.length === 0) {
    throw new Error('CSV file appears to be empty.');
  }

  const schema = buildSchema(headers);
  const result = {
    schema,
    rows: buildRows(records, schema),
  };

  pedigreeCache.set(fileName, result);
  return result;
}

function buildColumnDefs(schema) {
  return schema.map((column) => ({
    field: column.field,
    headerName: column.headerName,
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 140,
    flex: 1,
  }));
}

function autoSizeAllColumns(api, columnDefs) {
  const allColumnIds = columnDefs.map((column) => column.field);

  requestAnimationFrame(() => {
    api.autoSizeColumns(allColumnIds, false);
  });
}

function updateStatus(rowCount) {
  if (!gridApi) {
    statusElement.textContent = `Loaded ${rowCount} rows from ${activePedigree.label}.`;
    return;
  }

  const displayedCount = gridApi.getDisplayedRowCount();
  statusElement.textContent = `Showing ${displayedCount} of ${rowCount} rows from ${activePedigree.label}.`;
}

function updateHeaderContent() {
  titleElement.textContent = activePedigree.label;
  subtitleElement.textContent = activePedigree.subtitle;
}

function updateActiveTabs() {
  pedigreeTabs.forEach((tab) => {
    const isActive = tab.dataset.pedigreeTab === activePedigree.id;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function resetGridContext() {
  quickFilterInput.value = '';

  if (!gridApi) {
    return;
  }

  gridApi.setFilterModel(null);
  gridApi.setGridOption('quickFilterText', '');
}

function renderTable(schema, rows) {
  const columnDefs = buildColumnDefs(schema);

  if (!gridApi) {
    const gridOptions = {
      columnDefs,
      rowData: rows,
      defaultColDef: {
        sortable: true,
        filter: true,
        floatingFilter: true,
        resizable: true,
      },
      animateRows: true,
      pagination: true,
      paginationPageSize: 50,
      onGridReady(event) {
        gridApi = event.api;
        autoSizeAllColumns(event.api, columnDefs);
        updateStatus(rows.length);
      },
      onFirstDataRendered(event) {
        autoSizeAllColumns(event.api, columnDefs);
      },
      onFilterChanged() {
        updateStatus(rows.length);
      },
      onSortChanged() {
        updateStatus(rows.length);
      },
      onPaginationChanged() {
        updateStatus(rows.length);
      },
    };

    agGrid.createGrid(gridElement, gridOptions);
    return;
  }

  gridApi.setGridOption('columnDefs', columnDefs);
  gridApi.setGridOption('rowData', rows);
  autoSizeAllColumns(gridApi, columnDefs);
  updateStatus(rows.length);
}

async function setActivePedigree(pedigreeId) {
  const pedigree = PEDIGREE_SOURCES.find((item) => item.id === pedigreeId);

  if (!pedigree || pedigree.id === activePedigree.id) {
    return;
  }

  activePedigree = pedigree;
  updateActiveTabs();
  updateHeaderContent();
  resetGridContext();
  statusElement.textContent = `Loading ${activePedigree.label}…`;

  try {
    const { schema, rows } = await loadPedigreeData(activePedigree.fileName);
    renderTable(schema, rows);
  } catch (error) {
    console.error(error);
    statusElement.textContent = `Failed to load CSV data: ${error.message}`;
  }
}

async function init() {
  updateHeaderContent();
  updateActiveTabs();

  pedigreeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setActivePedigree(tab.dataset.pedigreeTab);
    });
  });

  quickFilterInput.addEventListener('input', (event) => {
    if (!gridApi) {
      return;
    }

    gridApi.setGridOption('quickFilterText', event.target.value);
    updateStatus(gridApi.getDisplayedRowCount());
  });

  try {
    const { schema, rows } = await loadPedigreeData(activePedigree.fileName);
    renderTable(schema, rows);
  } catch (error) {
    console.error(error);
    statusElement.textContent = `Failed to load CSV data: ${error.message}`;
  }
}

init();
