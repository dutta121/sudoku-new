// solver-worker.js — Runs in a Web Worker thread
// Optimized Sudoku solver using constraint propagation + backtracking with MCV heuristic
// Sends real-time progress updates to the main thread

let progressGridSize = 0;
let lastProgressTime = 0;
const PROGRESS_INTERVAL = 60; // ms between progress updates

self.onmessage = function (e) {
    const { action, board, gridSize, boxRows, boxCols } = e.data;
    progressGridSize = gridSize;

    if (action === 'solve') {
        const result = solveOptimized(board, gridSize, boxRows, boxCols);
        self.postMessage({ action: 'solved', board: result.board, success: result.success });
    } else if (action === 'generate') {
        const solved = generateSolvedBoard(gridSize, boxRows, boxCols);
        const clueCount = getClueCount(gridSize);
        const puzzle = removeCells(solved, clueCount, gridSize);
        self.postMessage({ action: 'generated', board: puzzle });
    }
};

// ─── Progress Reporting ───────────────────────────────────────

function countFilled(b) {
    let filled = 0;
    for (let r = 0; r < progressGridSize; r++) {
        for (let c = 0; c < progressGridSize; c++) {
            if (b[r][c] !== 0) filled++;
        }
    }
    return filled;
}

function sendProgress(b) {
    const now = Date.now();
    if (now - lastProgressTime < PROGRESS_INTERVAL) return;
    lastProgressTime = now;

    const filled = countFilled(b);
    const total = progressGridSize * progressGridSize;
    self.postMessage({
        action: 'progress',
        filled: filled,
        empty: total - filled,
        total: total,
    });
}

// ─── Optimized Solver ─────────────────────────────────────────

function solveOptimized(board, gridSize, boxRows, boxCols) {
    const b = board.map(row => [...row]);
    lastProgressTime = 0; // reset so first progress fires immediately

    // Build candidate sets for each cell
    const candidates = Array.from({ length: gridSize }, () =>
        Array.from({ length: gridSize }, () => new Set())
    );

    // Initialize candidates
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (b[r][c] === 0) {
                for (let n = 1; n <= gridSize; n++) {
                    if (isValid(b, r, c, n, gridSize, boxRows, boxCols)) {
                        candidates[r][c].add(n);
                    }
                }
            }
        }
    }

    const success = backtrack(b, candidates, gridSize, boxRows, boxCols);
    return { board: b, success };
}

function backtrack(b, candidates, gridSize, boxRows, boxCols) {
    // Send progress update
    sendProgress(b);

    // Find the empty cell with the fewest candidates (MCV heuristic)
    let minCount = gridSize + 1;
    let bestR = -1, bestC = -1;

    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (b[r][c] === 0) {
                const count = candidates[r][c].size;
                if (count === 0) return false;
                if (count < minCount) {
                    minCount = count;
                    bestR = r;
                    bestC = c;
                    if (count === 1) break;
                }
            }
        }
        if (minCount === 1) break;
    }

    if (bestR === -1) return true; // Solved

    const nums = [...candidates[bestR][bestC]];
    for (const num of nums) {
        if (!isValid(b, bestR, bestC, num, gridSize, boxRows, boxCols)) continue;

        b[bestR][bestC] = num;

        const removed = [];
        removeCandidateFromPeers(bestR, bestC, num, candidates, gridSize, boxRows, boxCols, removed);

        if (backtrack(b, candidates, gridSize, boxRows, boxCols)) return true;

        b[bestR][bestC] = 0;
        restoreCandidates(removed, candidates);
    }

    return false;
}

function removeCandidateFromPeers(row, col, num, candidates, gridSize, boxRows, boxCols, removed) {
    for (let c = 0; c < gridSize; c++) {
        if (c !== col && candidates[row][c].has(num)) {
            candidates[row][c].delete(num);
            removed.push({ r: row, c: c, n: num });
        }
    }
    for (let r = 0; r < gridSize; r++) {
        if (r !== row && candidates[r][col].has(num)) {
            candidates[r][col].delete(num);
            removed.push({ r: r, c: col, n: num });
        }
    }
    const br = Math.floor(row / boxRows) * boxRows;
    const bc = Math.floor(col / boxCols) * boxCols;
    for (let r = br; r < br + boxRows; r++) {
        for (let c = bc; c < bc + boxCols; c++) {
            if ((r !== row || c !== col) && candidates[r][c].has(num)) {
                candidates[r][c].delete(num);
                removed.push({ r: r, c: c, n: num });
            }
        }
    }
}

function restoreCandidates(removed, candidates) {
    for (const { r, c, n } of removed) {
        candidates[r][c].add(n);
    }
}

function isValid(b, row, col, num, gridSize, boxRows, boxCols) {
    for (let c = 0; c < gridSize; c++) {
        if (b[row][c] === num) return false;
    }
    for (let r = 0; r < gridSize; r++) {
        if (b[r][col] === num) return false;
    }
    const br = Math.floor(row / boxRows) * boxRows;
    const bc = Math.floor(col / boxCols) * boxCols;
    for (let r = br; r < br + boxRows; r++) {
        for (let c = bc; c < bc + boxCols; c++) {
            if (b[r][c] === num) return false;
        }
    }
    return true;
}

// ─── Random Board Generation ──────────────────────────────────

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function solveRandom(b, gridSize, boxRows, boxCols) {
    const empty = findEmpty(b, gridSize);
    if (!empty) return true;
    const [row, col] = empty;

    const nums = shuffle(Array.from({ length: gridSize }, (_, i) => i + 1));
    for (const num of nums) {
        if (isValid(b, row, col, num, gridSize, boxRows, boxCols)) {
            b[row][col] = num;
            sendProgress(b);
            if (solveRandom(b, gridSize, boxRows, boxCols)) return true;
            b[row][col] = 0;
        }
    }
    return false;
}

function findEmpty(b, gridSize) {
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (b[r][c] === 0) return [r, c];
        }
    }
    return null;
}

function generateSolvedBoard(gridSize, boxRows, boxCols) {
    const b = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
    if (gridSize >= 16) {
        const firstRow = shuffle(Array.from({ length: gridSize }, (_, i) => i + 1));
        b[0] = firstRow;
    }
    solveRandom(b, gridSize, boxRows, boxCols);
    return b;
}

function getClueCount(n) {
    if (n === 4) return 6 + Math.floor(Math.random() * 3);
    if (n === 9) return 28 + Math.floor(Math.random() * 5);
    if (n === 16) return 80 + Math.floor(Math.random() * 21);
    return Math.floor(n * n * 0.35);
}

function removeCells(solved, cluesToKeep, gridSize) {
    const puzzle = solved.map(row => [...row]);
    const totalCells = gridSize * gridSize;
    const cellsToRemove = totalCells - cluesToKeep;

    const positions = [];
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            positions.push([r, c]);
        }
    }
    shuffle(positions);

    let removed = 0;
    for (const [r, c] of positions) {
        if (removed >= cellsToRemove) break;
        puzzle[r][c] = 0;
        removed++;
    }

    return puzzle;
}
