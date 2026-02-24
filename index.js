(() => {
  'use strict';

  // ─── State ────────────────────────────────────────────────────
  let gridSize = 4;
  let boxRows = 2;
  let boxCols = 2;
  let board = [];
  let cachedSolution = null;

  // ─── Web Worker ───────────────────────────────────────────────
  const worker = new Worker('solver-worker.js');
  let workerCallback = null;

  worker.onmessage = function (e) {
    const data = e.data;

    if (data.action === 'progress') {
      // Live progress update — update the stats in the loading overlay
      updateLoadingStats(data.filled, data.empty, data.total);
      return;
    }

    // Completion messages (solved / generated)
    if (workerCallback) {
      workerCallback(data);
      workerCallback = null;
    }
  };

  function runWorker(data) {
    return new Promise((resolve) => {
      workerCallback = resolve;
      worker.postMessage(data);
    });
  }

  function updateLoadingStats(filled, empty, total) {
    if (!loadingStats) return;
    const pct = Math.round((filled / total) * 100);
    loadingStats.innerHTML =
      `<span class="stat-filled">✓ ${filled} filled</span>` +
      `<span>|</span>` +
      `<span class="stat-empty">○ ${empty} empty</span>` +
      `<span>|</span>` +
      `<span>${pct}%</span>`;
  }

  // ─── DOM refs ─────────────────────────────────────────────────
  const gridEl = document.getElementById('sudokuGrid');
  const statusEl = document.getElementById('status');
  const gridCard = document.querySelector('.grid-card');
  const sizeSelector = document.getElementById('sizeSelector');
  const btnSolve = document.getElementById('btnSolve');
  const btnClear = document.getElementById('btnClear');
  const btnSample = document.getElementById('btnSample');
  const btnHint = document.getElementById('btnHint');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = loadingOverlay.querySelector('.loading-text');
  const loadingStats = document.getElementById('loadingStats');

  // ─── Loading helpers ──────────────────────────────────────────
  function showLoading(msg) {
    loadingText.innerHTML = msg + '<span class="dots"></span>';

    // Count filled and empty cells
    let filled = 0;
    let empty = 0;
    const total = gridSize * gridSize;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c] !== 0) filled++;
      }
    }
    empty = total - filled;

    if (filled > 0 || msg.includes('Solving') || msg.includes('hint')) {
      loadingStats.innerHTML =
        `<span class="stat-filled">✓ ${filled} filled</span>` +
        `<span>|</span>` +
        `<span class="stat-empty">○ ${empty} empty</span>` +
        `<span>|</span>` +
        `<span>${total} total</span>`;
    } else {
      loadingStats.innerHTML = `<span>${total} cells</span>`;
    }

    loadingOverlay.classList.add('active');
    btnSolve.disabled = true;
    btnHint.disabled = true;
    btnClear.disabled = true;
    btnSample.disabled = true;
  }

  function hideLoading() {
    loadingOverlay.classList.remove('active');
    loadingStats.innerHTML = '';
    btnSolve.disabled = false;
    btnHint.disabled = false;
    btnClear.disabled = false;
    btnSample.disabled = false;
  }

  // ─── Box dimensions for each grid size ────────────────────────
  function getBoxDimensions(n) {
    if (n === 4) return { rows: 2, cols: 2 };
    if (n === 9) return { rows: 3, cols: 3 };
    if (n === 16) return { rows: 4, cols: 4 };
    const sqrt = Math.floor(Math.sqrt(n));
    return { rows: sqrt, cols: sqrt };
  }

  // ─── Build Grid ───────────────────────────────────────────────
  function buildGrid() {
    gridEl.innerHTML = '';
    gridEl.className = `sudoku-grid size-${gridSize}`;
    gridCard.classList.remove('solved', 'error');
    setStatus('', '');
    cachedSolution = null;

    const dims = getBoxDimensions(gridSize);
    boxRows = dims.rows;
    boxCols = dims.cols;

    board = Array.from({ length: gridSize }, () =>
      Array(gridSize).fill(0)
    );

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = gridSize <= 9 ? 1 : 2;
        input.className = `cell size-${gridSize}`;
        input.dataset.row = r;
        input.dataset.col = c;
        input.id = `cell-${r}-${c}`;
        input.setAttribute('aria-label', `Row ${r + 1} Column ${c + 1}`);
        input.autocomplete = 'off';

        // Sub-grid thick borders
        if (c % boxCols === 0 && c !== 0) input.classList.add('border-left-thick');
        if ((c + 1) % boxCols === 0 && c !== gridSize - 1) input.classList.add('border-right-thick');
        if (r % boxRows === 0 && r !== 0) input.classList.add('border-top-thick');
        if ((r + 1) % boxRows === 0 && r !== gridSize - 1) input.classList.add('border-bottom-thick');

        // Outer edges
        if (r === 0) input.classList.add('border-top-thick');
        if (r === gridSize - 1) input.classList.add('border-bottom-thick');
        if (c === 0) input.classList.add('border-left-thick');
        if (c === gridSize - 1) input.classList.add('border-right-thick');

        input.addEventListener('input', handleInput);
        input.addEventListener('keydown', handleKeyDown);

        gridEl.appendChild(input);
      }
    }
  }

  // ─── Input Handling ───────────────────────────────────────────
  function handleInput(e) {
    const input = e.target;
    const r = +input.dataset.row;
    const c = +input.dataset.col;
    let raw = input.value.trim().toUpperCase();

    gridCard.classList.remove('solved', 'error');
    setStatus('', '');
    cachedSolution = null;

    let val = 0;
    if (gridSize <= 9) {
      val = parseInt(raw, 10);
      if (isNaN(val) || val < 1 || val > gridSize) {
        input.value = '';
        board[r][c] = 0;
        input.classList.remove('conflict', 'given');
        clearConflicts();
        return;
      }
    } else {
      if (/^[1-9]$/.test(raw)) {
        val = parseInt(raw, 10);
      } else if (/^1[0-6]$/.test(raw)) {
        val = parseInt(raw, 10);
      } else if (/^[A-G]$/.test(raw)) {
        val = raw.charCodeAt(0) - 55;
      } else {
        input.value = '';
        board[r][c] = 0;
        input.classList.remove('conflict', 'given');
        clearConflicts();
        return;
      }
    }

    input.value = formatValue(val);
    board[r][c] = val;
    input.classList.add('given');
    input.classList.remove('solved-cell');
    checkConflicts();
  }

  function formatValue(val) {
    if (val === 0) return '';
    if (gridSize <= 9) return String(val);
    if (val <= 9) return String(val);
    return String.fromCharCode(55 + val);
  }

  function handleKeyDown(e) {
    const r = +e.target.dataset.row;
    const c = +e.target.dataset.col;
    let nr = r, nc = c;

    switch (e.key) {
      case 'ArrowUp': nr = Math.max(0, r - 1); break;
      case 'ArrowDown': nr = Math.min(gridSize - 1, r + 1); break;
      case 'ArrowLeft': nc = Math.max(0, c - 1); break;
      case 'ArrowRight': nc = Math.min(gridSize - 1, c + 1); break;
      case 'Backspace':
      case 'Delete':
        e.target.value = '';
        board[r][c] = 0;
        e.target.classList.remove('conflict', 'given');
        clearConflicts();
        return;
      default: return;
    }

    e.preventDefault();
    const target = document.getElementById(`cell-${nr}-${nc}`);
    if (target) target.focus();
  }

  // ─── Conflict Detection ───────────────────────────────────────
  function clearConflicts() {
    gridEl.querySelectorAll('.cell.conflict').forEach(c =>
      c.classList.remove('conflict')
    );
  }

  function checkConflicts() {
    clearConflicts();
    let hasConflict = false;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c] === 0) continue;
        if (isConflict(r, c, board[r][c])) {
          document.getElementById(`cell-${r}-${c}`).classList.add('conflict');
          hasConflict = true;
        }
      }
    }

    return hasConflict;
  }

  function isConflict(row, col, val) {
    for (let c = 0; c < gridSize; c++) {
      if (c !== col && board[row][c] === val) return true;
    }
    for (let r = 0; r < gridSize; r++) {
      if (r !== row && board[r][col] === val) return true;
    }
    const br = Math.floor(row / boxRows) * boxRows;
    const bc = Math.floor(col / boxCols) * boxCols;
    for (let r = br; r < br + boxRows; r++) {
      for (let c = bc; c < bc + boxCols; c++) {
        if (r !== row && c !== col && board[r][c] === val) return true;
      }
    }
    return false;
  }

  // ─── UI Actions (all use Web Worker) ──────────────────────────

  async function handleSolve() {
    gridCard.classList.remove('solved', 'error');
    clearConflicts();

    if (checkConflicts()) {
      setStatus('Fix conflicts before solving.', 'error');
      gridCard.classList.add('error');
      return;
    }

    showLoading('Solving puzzle');

    const givenCells = new Set();
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c] !== 0) givenCells.add(`${r}-${c}`);
      }
    }

    const result = await runWorker({
      action: 'solve',
      board: board.map(row => [...row]),
      gridSize,
      boxRows,
      boxCols,
    });

    hideLoading();

    if (result.success) {
      let delay = 0;
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          if (!givenCells.has(`${r}-${c}`)) {
            const cell = document.getElementById(`cell-${r}-${c}`);
            delay += 18;
            setTimeout(() => {
              cell.value = formatValue(result.board[r][c]);
              cell.classList.add('solved-cell');
            }, delay);
          }
        }
      }
      board = result.board;
      setTimeout(() => {
        gridCard.classList.add('solved');
        setStatus('✓ Puzzle solved!', 'success');
      }, delay + 50);
    } else {
      gridCard.classList.add('error');
      setStatus('✗ No solution exists for this puzzle.', 'error');
    }
  }

  function handleClear() {
    buildGrid();
  }

  async function handleHint() {
    gridCard.classList.remove('solved', 'error');
    clearConflicts();

    if (checkConflicts()) {
      setStatus('Fix conflicts before getting a hint.', 'error');
      gridCard.classList.add('error');
      return;
    }

    // Find all empty cells
    const emptyCells = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c] === 0) emptyCells.push([r, c]);
      }
    }

    if (emptyCells.length === 0) {
      setStatus('No empty cells left!', 'success');
      return;
    }

    // Check if the board has at least 1 given clue
    let hasAnyClue = false;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c] !== 0) { hasAnyClue = true; break; }
      }
      if (hasAnyClue) break;
    }
    if (!hasAnyClue) {
      setStatus('Enter some numbers first, then ask for a hint.', 'error');
      return;
    }

    // Solve if not cached
    if (!cachedSolution) {
      showLoading('Finding a hint');

      const result = await runWorker({
        action: 'solve',
        board: board.map(row => [...row]),
        gridSize,
        boxRows,
        boxCols,
      });

      hideLoading();

      if (!result.success) {
        setStatus('✗ No solution — cannot provide a hint.', 'error');
        gridCard.classList.add('error');
        return;
      }
      cachedSolution = result.board;
    }

    // Pick a random empty cell and reveal it
    const [hr, hc] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    board[hr][hc] = cachedSolution[hr][hc];
    const cell = document.getElementById(`cell-${hr}-${hc}`);
    cell.value = formatValue(cachedSolution[hr][hc]);
    cell.classList.add('solved-cell', 'given');
    cell.focus();
    setStatus(`💡 Hint: Row ${hr + 1}, Col ${hc + 1}`, 'success');

    if (emptyCells.length === 1) {
      gridCard.classList.add('solved');
      setStatus('✓ Puzzle complete!', 'success');
    }
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (type ? ` ${type}` : '');
  }

  // ─── Random Puzzle Generation (via Worker) ────────────────────

  async function loadSample() {
    buildGrid();
    showLoading('Generating puzzle');

    const result = await runWorker({
      action: 'generate',
      board: null,
      gridSize,
      boxRows,
      boxCols,
    });

    hideLoading();

    const puzzle = result.board;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (puzzle[r][c] !== 0) {
          board[r][c] = puzzle[r][c];
          const cell = document.getElementById(`cell-${r}-${c}`);
          cell.value = formatValue(puzzle[r][c]);
          cell.classList.add('given');
        }
      }
    }
    setStatus('✦ New puzzle generated!', 'success');
  }

  // ─── Size Selection ───────────────────────────────────────────
  sizeSelector.addEventListener('click', (e) => {
    const option = e.target.closest('.size-option');
    if (!option) return;

    sizeSelector.querySelectorAll('.size-option').forEach(o =>
      o.classList.remove('selected')
    );
    option.classList.add('selected');

    gridSize = +option.dataset.size;
    buildGrid();
  });

  // ─── Button Events ────────────────────────────────────────────
  btnSolve.addEventListener('click', handleSolve);
  btnClear.addEventListener('click', handleClear);
  btnSample.addEventListener('click', loadSample);
  btnHint.addEventListener('click', handleHint);

  // ─── Init ─────────────────────────────────────────────────────
  buildGrid();
})();
