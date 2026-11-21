// chess-engine.js —— 国际象棋 / 中国象棋 / 围棋的纯规则引擎（无 DOM、无网络）
// 只负责合法性、胜负与终局判定；联机与计时在 chess-online.js。

// ==================== 国际象棋 ====================
const ChessEngine = (function () {
    const FILES = 'abcdefgh';
    const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
    const idx = (r, c) => r * 8 + c;
    const colorOf = p => (p ? p[0] : '');

    function initial() {
        const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
        const board = new Array(64).fill(null);
        for (let c = 0; c < 8; c++) {
            board[c] = 'b' + back[c];
            board[8 + c] = 'bP';
            board[48 + c] = 'wP';
            board[56 + c] = 'w' + back[c];
        }
        return { board, turn: 'w', castle: { wK: 1, wQ: 1, bK: 1, bQ: 1 }, ep: -1, half: 0 };
    }

    function clone(s) {
        return {
            board: s.board.slice(),
            turn: s.turn,
            castle: { ...s.castle },
            ep: s.ep,
            half: s.half
        };
    }

    function attacked(s, target, by) {
        const tr = Math.floor(target / 8), tc = target % 8;
        for (let i = 0; i < 64; i++) {
            const p = s.board[i];
            if (!p || p[0] !== by) continue;
            const r = Math.floor(i / 8), c = i % 8;
            const dr = tr - r, dc = tc - c;
            const t = p[1];
            if (t === 'P') {
                const dir = by === 'w' ? -1 : 1;
                if (dr === dir && Math.abs(dc) === 1) return true;
            } else if (t === 'N') {
                if ((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)) return true;
            } else if (t === 'K') {
                if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) return true;
            } else {
                const straight = t === 'R' || t === 'Q';
                const diag = t === 'B' || t === 'Q';
                if (straight && (dr === 0 || dc === 0)) {
                    const stepR = Math.sign(dr), stepC = Math.sign(dc);
                    let rr = r + stepR, cc = c + stepC, blocked = false;
                    while (rr !== tr || cc !== tc) {
                        if (s.board[idx(rr, cc)]) { blocked = true; break; }
                        rr += stepR; cc += stepC;
                    }
                    if (!blocked) return true;
                }
                if (diag && Math.abs(dr) === Math.abs(dc)) {
                    const stepR = Math.sign(dr), stepC = Math.sign(dc);
                    let rr = r + stepR, cc = c + stepC, blocked = false;
                    while (rr !== tr || cc !== tc) {
                        if (s.board[idx(rr, cc)]) { blocked = true; break; }
                        rr += stepR; cc += stepC;
                    }
                    if (!blocked) return true;
                }
            }
        }
        return false;
    }

    function kingSquare(s, color) {
        const k = color + 'K';
        for (let i = 0; i < 64; i++) if (s.board[i] === k) return i;
        return -1;
    }

    function inCheck(s, color) {
        const k = kingSquare(s, color);
        return k >= 0 && attacked(s, k, color === 'w' ? 'b' : 'w');
    }

    function pseudoMoves(s, color) {
        const out = [];
        for (let i = 0; i < 64; i++) {
            const p = s.board[i];
            if (!p || p[0] !== color) continue;
            const r = Math.floor(i / 8), c = i % 8;
            const t = p[1];
            if (t === 'P') {
                const dir = color === 'w' ? -1 : 1;
                const startRow = color === 'w' ? 6 : 1;
                const lastRow = color === 'w' ? 0 : 7;
                if (inBoard(r + dir, c) && !s.board[idx(r + dir, c)]) {
                    const to = idx(r + dir, c);
                    if (r + dir === lastRow) ['Q', 'R', 'B', 'N'].forEach(pr => out.push({ from: i, to, promo: pr }));
                    else out.push({ from: i, to });
                    if (r === startRow && !s.board[idx(r + 2 * dir, c)]) {
                        out.push({ from: i, to: idx(r + 2 * dir, c), double: true });
                    }
                }
                for (const dc of [-1, 1]) {
                    if (!inBoard(r + dir, c + dc)) continue;
                    const to = idx(r + dir, c + dc);
                    const q = s.board[to];
                    if (q && q[0] !== color) {
                        if (r + dir === lastRow) ['Q', 'R', 'B', 'N'].forEach(pr => out.push({ from: i, to, promo: pr, capture: true }));
                        else out.push({ from: i, to, capture: true });
                    } else if (!q && to === s.ep) {
                        out.push({ from: i, to, enpassant: true, capture: true });
                    }
                }
            } else if (t === 'N') {
                [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => {
                    if (!inBoard(r + dr, c + dc)) return;
                    const to = idx(r + dr, c + dc);
                    if (!s.board[to] || s.board[to][0] !== color) out.push({ from: i, to });
                });
            } else if (t === 'K') {
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                    if (!dr && !dc) continue;
                    if (!inBoard(r + dr, c + dc)) continue;
                    const to = idx(r + dr, c + dc);
                    if (!s.board[to] || s.board[to][0] !== color) out.push({ from: i, to });
                }
                const opp = color === 'w' ? 'b' : 'w';
                if (color === 'w' && i === 60) {
                    if (s.castle.wK && !s.board[61] && !s.board[62] && s.board[63] === 'wR' &&
                        !attacked(s, 60, opp) && !attacked(s, 61, opp) && !attacked(s, 62, opp)) {
                        out.push({ from: 60, to: 62, castle: 'K' });
                    }
                    if (s.castle.wQ && !s.board[59] && !s.board[58] && !s.board[57] && s.board[56] === 'wR' &&
                        !attacked(s, 60, opp) && !attacked(s, 59, opp) && !attacked(s, 58, opp)) {
                        out.push({ from: 60, to: 58, castle: 'Q' });
                    }
                }
                if (color === 'b' && i === 4) {
                    if (s.castle.bK && !s.board[5] && !s.board[6] && s.board[7] === 'bR' &&
                        !attacked(s, 4, opp) && !attacked(s, 5, opp) && !attacked(s, 6, opp)) {
                        out.push({ from: 4, to: 6, castle: 'K' });
                    }
                    if (s.castle.bQ && !s.board[3] && !s.board[2] && !s.board[1] && s.board[0] === 'bR' &&
                        !attacked(s, 4, opp) && !attacked(s, 3, opp) && !attacked(s, 2, opp)) {
                        out.push({ from: 4, to: 2, castle: 'Q' });
                    }
                }
            } else {
                const dirs = [];
                if (t === 'R' || t === 'Q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
                if (t === 'B' || t === 'Q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
                dirs.forEach(([dr, dc]) => {
                    let rr = r + dr, cc = c + dc;
                    while (inBoard(rr, cc)) {
                        const to = idx(rr, cc);
                        if (!s.board[to]) out.push({ from: i, to });
                        else {
                            if (s.board[to][0] !== color) out.push({ from: i, to, capture: true });
                            break;
                        }
                        rr += dr; cc += dc;
                    }
                });
            }
        }
        return out;
    }

    function apply(s, m) {
        const n = clone(s);
        const piece = n.board[m.from];
        const color = piece[0];
        n.board[m.from] = null;
        if (m.enpassant) {
            const capRow = color === 'w' ? Math.floor(m.to / 8) + 1 : Math.floor(m.to / 8) - 1;
            n.board[idx(capRow, m.to % 8)] = null;
        }
        n.board[m.to] = m.promo ? color + m.promo : piece;
        if (m.castle === 'K') {
            if (color === 'w') { n.board[63] = null; n.board[61] = 'wR'; }
            else { n.board[7] = null; n.board[5] = 'bR'; }
        } else if (m.castle === 'Q') {
            if (color === 'w') { n.board[56] = null; n.board[59] = 'wR'; }
            else { n.board[0] = null; n.board[3] = 'bR'; }
        }
        if (piece[1] === 'K') {
            n.castle[color + 'K'] = 0;
            n.castle[color + 'Q'] = 0;
        }
        if (piece[1] === 'R') {
            if (m.from === 63) n.castle.wK = 0;
            if (m.from === 56) n.castle.wQ = 0;
            if (m.from === 7) n.castle.bK = 0;
            if (m.from === 0) n.castle.bQ = 0;
        }
        if (m.to === 63) n.castle.wK = 0;
        if (m.to === 56) n.castle.wQ = 0;
        if (m.to === 7) n.castle.bK = 0;
        if (m.to === 0) n.castle.bQ = 0;

        n.ep = -1;
        if (m.double) n.ep = (m.from + m.to) / 2;
        n.half = (piece[1] === 'P' || m.capture) ? 0 : n.half + 1;
        n.turn = color === 'w' ? 'b' : 'w';
        return n;
    }

    function legalMoves(s, color) {
        const c = color || s.turn;
        return pseudoMoves(s, c).filter(m => !inCheck(apply(s, m), c));
    }

    function status(s) {
        const moves = legalMoves(s, s.turn);
        if (!moves.length) return inCheck(s, s.turn) ? 'checkmate' : 'stalemate';
        return inCheck(s, s.turn) ? 'check' : 'playing';
    }

    // 超时判和：未超时一方只剩单王 / 王+单象 / 王+单马
    function insufficient(color, s) {
        const others = s.board.filter(p => p && p[0] === color && p[1] !== 'K');
        if (others.length === 0) return true;
        if (others.length === 1 && (others[0][1] === 'B' || others[0][1] === 'N')) return true;
        return false;
    }

    function squareName(i) {
        return FILES[i % 8] + (8 - Math.floor(i / 8));
    }

    return { initial, clone, apply, legalMoves, inCheck, status, insufficient, squareName, idx };
})();

// ==================== 中国象棋 ====================
const XiangqiEngine = (function () {
    const RED = 'r', BLACK = 'b';
    const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
    const idx = (r, c) => r * 9 + c;

    function initial() {
        const b = new Array(90).fill(null);
        const back = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];
        for (let c = 0; c < 9; c++) {
            b[c] = BLACK + back[c];
            b[81 + c] = RED + back[c];
        }
        b[idx(2, 1)] = BLACK + 'C';
        b[idx(2, 7)] = BLACK + 'C';
        b[idx(7, 1)] = RED + 'C';
        b[idx(7, 7)] = RED + 'C';
        for (let c = 0; c < 9; c += 2) {
            b[idx(3, c)] = BLACK + 'P';
            b[idx(6, c)] = RED + 'P';
        }
        return { board: b, turn: RED };
    }

    function clone(s) { return { board: s.board.slice(), turn: s.turn }; }

    function inPalace(color, r, c) {
        if (c < 3 || c > 5) return false;
        return color === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
    }

    function kingPos(s, color) {
        const k = color + 'K';
        for (let i = 0; i < 90; i++) if (s.board[i] === k) return i;
        return -1;
    }

    function kingsFacing(s) {
        const rk = kingPos(s, RED), bk = kingPos(s, BLACK);
        if (rk < 0 || bk < 0) return false;
        const rc = rk % 9, bc = bk % 9;
        if (rc !== bc) return false;
        const r1 = Math.floor(rk / 9), r2 = Math.floor(bk / 9);
        const from = Math.min(r1, r2) + 1, to = Math.max(r1, r2) - 1;
        for (let r = from; r <= to; r++) if (s.board[idx(r, rc)]) return false;
        return true;
    }

    function attacked(s, target, by) {
        const tr = Math.floor(target / 9), tc = target % 9;
        for (let i = 0; i < 90; i++) {
            const p = s.board[i];
            if (!p || p[0] !== by) continue;
            const r = Math.floor(i / 9), c = i % 9;
            const t = p[1];
            const dr = tr - r, dc = tc - c;
            if (t === 'K') {
                if (Math.abs(dr) + Math.abs(dc) === 1) return true;
                if (c === tc) {
                    let blocked = false;
                    const from = Math.min(r, tr) + 1, to = Math.max(r, tr) - 1;
                    for (let rr = from; rr <= to; rr++) if (s.board[idx(rr, c)]) blocked = true;
                    if (!blocked) return true; // 将帅照面
                }
            } else if (t === 'A') {
                if (Math.abs(dr) === 1 && Math.abs(dc) === 1 && inPalace(by, tr, tc)) return true;
            } else if (t === 'E') {
                if (Math.abs(dr) === 2 && Math.abs(dc) === 2 && s.board[idx(r + dr / 2, c + dc / 2)] === null) {
                    if (by === RED ? tr >= 5 : tr <= 4) return true;
                }
            } else if (t === 'H') {
                if (Math.abs(dr) === 2 && Math.abs(dc) === 1) {
                    if (!s.board[idx(r + dr / 2, c)]) return true;
                } else if (Math.abs(dr) === 1 && Math.abs(dc) === 2) {
                    if (!s.board[idx(r, c + dc / 2)]) return true;
                }
            } else if (t === 'R') {
                if (dr === 0 || dc === 0) {
                    const stepR = Math.sign(dr), stepC = Math.sign(dc);
                    let rr = r + stepR, cc = c + stepC, blocked = false;
                    while (rr !== tr || cc !== tc) {
                        if (s.board[idx(rr, cc)]) { blocked = true; break; }
                        rr += stepR; cc += stepC;
                    }
                    if (!blocked) return true;
                }
            } else if (t === 'C') {
                if (dr === 0 || dc === 0) {
                    const stepR = Math.sign(dr), stepC = Math.sign(dc);
                    let rr = r + stepR, cc = c + stepC, screens = 0;
                    while (rr !== tr || cc !== tc) {
                        if (s.board[idx(rr, cc)]) screens++;
                        rr += stepR; cc += stepC;
                    }
                    if (screens === 1) return true;
                }
            } else if (t === 'P') {
                const fwd = by === RED ? -1 : 1;
                if (dr === fwd && dc === 0) return true;
                const crossed = by === RED ? r <= 4 : r >= 5;
                if (crossed && dr === 0 && Math.abs(dc) === 1) return true;
            }
        }
        return false;
    }

    function inCheck(s, color) {
        const k = kingPos(s, color);
        if (k < 0) return true;
        return attacked(s, k, color === RED ? BLACK : RED) || kingsFacing(s);
    }

    function pseudoMoves(s, color) {
        const out = [];
        for (let i = 0; i < 90; i++) {
            const p = s.board[i];
            if (!p || p[0] !== color) continue;
            const r = Math.floor(i / 9), c = i % 9;
            const t = p[1];
            const push = (rr, cc) => {
                if (!inBoard(rr, cc)) return false;
                const to = idx(rr, cc);
                if (s.board[to] && s.board[to][0] === color) return false;
                out.push({ from: i, to });
                return !s.board[to];
            };
            if (t === 'K') {
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
                    if (inPalace(color, r + dr, c + dc)) push(r + dr, c + dc);
                });
                // 飞将：同列直接吃对方将
                const opp = color === RED ? BLACK : RED;
                for (let rr = color === RED ? r - 1 : r + 1; rr >= 0 && rr < 10; rr += color === RED ? -1 : 1) {
                    if (s.board[idx(rr, c)]) {
                        if (s.board[idx(rr, c)] === opp + 'K') out.push({ from: i, to: idx(rr, c) });
                        break;
                    }
                }
            } else if (t === 'A') {
                [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
                    if (inPalace(color, r + dr, c + dc)) push(r + dr, c + dc);
                });
            } else if (t === 'E') {
                [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dr, dc]) => {
                    const rr = r + dr, cc = c + dc;
                    if (!inBoard(rr, cc)) return;
                    if (s.board[idx(r + dr / 2, c + dc / 2)]) return;
                    if (color === RED ? rr < 5 : rr > 4) return;
                    push(rr, cc);
                });
            } else if (t === 'H') {
                [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => {
                    const legR = Math.abs(dr) === 2 ? r + dr / 2 : r;
                    const legC = Math.abs(dc) === 2 ? c + dc / 2 : c;
                    if (s.board[idx(legR, legC)]) return;
                    push(r + dr, c + dc);
                });
            } else if (t === 'R' || t === 'C') {
                [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
                    let rr = r + dr, cc = c + dc;
                    let screen = null;
                    while (inBoard(rr, cc)) {
                        const to = idx(rr, cc);
                        const q = s.board[to];
                        if (t === 'R') {
                            if (!q) out.push({ from: i, to });
                            else {
                                if (q[0] !== color) out.push({ from: i, to });
                                break;
                            }
                        } else {
                            if (!screen) {
                                if (!q) out.push({ from: i, to });
                                else screen = to;
                            } else if (q) {
                                if (q[0] !== color) out.push({ from: i, to, capture: true });
                                break;
                            }
                        }
                        rr += dr; cc += dc;
                    }
                });
            } else if (t === 'P') {
                const fwd = color === RED ? -1 : 1;
                push(r + fwd, c);
                const crossed = color === RED ? r <= 4 : r >= 5;
                if (crossed) {
                    push(r, c - 1);
                    push(r, c + 1);
                }
            }
        }
        return out;
    }

    function apply(s, m) {
        const n = clone(s);
        const piece = n.board[m.from];
        n.board[m.from] = null;
        n.board[m.to] = piece;
        n.turn = piece[0] === RED ? BLACK : RED;
        return n;
    }

    function legalMoves(s, color) {
        const c = color || s.turn;
        return pseudoMoves(s, c).filter(m => {
            const n = apply(s, m);
            return !inCheck(n, c);
        });
    }

    function status(s) {
        const moves = legalMoves(s, s.turn);
        if (!moves.length) return inCheck(s, s.turn) ? 'checkmate' : 'stalemate';
        return inCheck(s, s.turn) ? 'check' : 'playing';
    }

    return { initial, clone, apply, legalMoves, inCheck, status, RED, BLACK };
})();

// ==================== 围棋（19 路，中国数子，贴 7.5 目） ====================
const GoEngine = (function () {
    const SIZE = 19;
    const KOMI = 7.5;

    function initial() {
        return {
            size: SIZE,
            board: new Array(SIZE * SIZE).fill(0),
            turn: 1,
            passes: 0,
            captures: [0, 0],
            prevBoard: '',      // 上一手前的局面（简单劫争判定）
            lastMove: -1,
            moves: 0
        };
    }

    function clone(s) {
        return {
            size: s.size,
            board: s.board.slice(),
            turn: s.turn,
            passes: s.passes,
            captures: s.captures.slice(),
            prevBoard: s.prevBoard,
            lastMove: s.lastMove,
            moves: s.moves
        };
    }

    function neighbors(i, size) {
        const r = Math.floor(i / size), c = i % size, out = [];
        if (r > 0) out.push(i - size);
        if (r < size - 1) out.push(i + size);
        if (c > 0) out.push(i - 1);
        if (c < size - 1) out.push(i + 1);
        return out;
    }

    function group(board, i, size) {
        const color = board[i];
        const stones = [i], seen = new Set([i]), libs = new Set();
        while (stones.length) {
            const cur = stones.pop();
            neighbors(cur, size).forEach(n => {
                if (board[n] === 0) libs.add(n);
                else if (board[n] === color && !seen.has(n)) { seen.add(n); stones.push(n); }
            });
        }
        return { stones: Array.from(seen), liberties: libs.size };
    }

    function play(s, i) {
        if (s.board[i] !== 0) return { ok: false, error: '该点已有棋子' };
        const n = clone(s);
        const color = n.turn, opp = color === 1 ? 2 : 1;
        const before = n.board.join(',');
        n.board[i] = color;
        let captured = 0;
        neighbors(i, n.size).forEach(nb => {
            if (n.board[nb] === opp) {
                const g = group(n.board, nb, n.size);
                if (g.liberties === 0) {
                    g.stones.forEach(st => { n.board[st] = 0; captured++; });
                }
            }
        });
        const own = group(n.board, i, n.size);
        if (own.liberties === 0) return { ok: false, error: '禁入点：不能自杀' };
        if (n.board.join(',') === n.prevBoard) return { ok: false, error: '打劫：不能立即回提' };
        n.prevBoard = before;
        n.captures[color - 1] += captured;
        n.passes = 0;
        n.lastMove = i;
        n.moves++;
        n.turn = opp;
        return { ok: true, state: n, captured };
    }

    function pass(s) {
        const n = clone(s);
        n.passes++;
        n.lastMove = -1;
        n.prevBoard = n.board.join(',');
        n.turn = n.turn === 1 ? 2 : 1;
        return { ok: true, state: n, ended: n.passes >= 2 };
    }

    // 中国规则数子：棋子数 + 仅被单方包围的空点；黑先、白贴 7.5 目
    function score(s) {
        const size = s.size, board = s.board;
        const seen = new Array(board.length).fill(false);
        let black = 0, white = 0;
        for (let i = 0; i < board.length; i++) {
            if (board[i] === 1) black++;
            else if (board[i] === 2) white++;
        }
        for (let i = 0; i < board.length; i++) {
            if (board[i] !== 0 || seen[i]) continue;
            const region = [i], stack = [i], borders = new Set();
            seen[i] = true;
            while (stack.length) {
                const cur = stack.pop();
                neighbors(cur, size).forEach(nb => {
                    if (board[nb] === 0) {
                        if (!seen[nb]) { seen[nb] = true; region.push(nb); stack.push(nb); }
                    } else borders.add(board[nb]);
                });
            }
            if (borders.size === 1) {
                if (borders.has(1)) black += region.length;
                else white += region.length;
            }
        }
        white += KOMI;
        return { black, white };
    }

    return { initial, play, pass, score, clone, SIZE, KOMI };
})();
