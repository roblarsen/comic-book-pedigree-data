const CSV_URL = './larson-list.csv';

const gridElement = document.getElementById('grid');
const quickFilterInput = document.getElementById('quick-filter');
const statusElement = document.getElementById('status');

let gridApi;

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

function buildColumnDefs(headers) {
  return headers.map((header) => ({
    field: header,
    headerName: header,
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

async function loadGrid() {
  try {
    const response = await fetch(CSV_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading CSV`);
    }

    const csvText = await response.text();
    const { headers, records } = parseCsv(csvText);

    if (headers.length === 0) {
      throw new Error('CSV file appears to be empty.');
    }

    const columnDefs = buildColumnDefs(headers);

    const gridOptions = {
      columnDefs,
      rowData: records,
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
        statusElement.textContent = `Loaded ${records.length} rows from larson-list.csv.`;
      },
      onFirstDataRendered(event) {
        autoSizeAllColumns(event.api, columnDefs);
      },
    };

    agGrid.createGrid(gridElement, gridOptions);
  } catch (error) {
    console.error(error);
    statusElement.textContent = `Failed to load CSV data: ${error.message}`;
  }
}

quickFilterInput.addEventListener('input', (event) => {
  if (!gridApi) {
    return;
  }

  gridApi.setGridOption('quickFilterText', event.target.value);
});

loadGrid();
