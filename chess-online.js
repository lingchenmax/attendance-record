// chess-online.js —— 棋类（国际象棋 / 中国象棋 A·B / 围棋）联机、计时与界面
// 依赖 app.js 中的全局：dbClient、currentUser、isAdmin、genUuid、genRoomCode、myDisplayName
// 与 chess-engine.js 中的 ChessEngine / XiangqiEngine / GoEngine

const CQ_PRESETS = {
    chess: [
        { id: 'p1', label: '快棋 3+2', base: 180000, inc: 2000 },
        { id: 'p2', label: '普通 10+5', base: 600000, inc: 5000 },
        { id: 'p3', label: '慢棋 20+10', base: 1200000, inc: 10000 }
    ],
    xq_a: [
        { id: 'p1', label: '快棋 3+1', base: 180000, inc: 1000 },
        { id: 'p2', label: '普通 8+3', base: 480000, inc: 3000 },
        { id: 'p3', label: '慢棋 15+5', base: 900000, inc: 5000 }
    ],
    xq_b: [
        { id: 'p1', label: '快棋 5/2/30s', game: 300000, move: 120000, byo: 30000 },
        { id: 'p2', label: '普通 10/3/60s', game: 600000, move: 180000, byo: 60000 },
        { id: 'p3', label: '慢棋 20/4/90s', game: 1200000, move: 240000, byo: 90000 }
    ],
    go: [
        { id: 'p1', label: '快棋 10m+3×20s', base: 600000, period: 20000, count: 3 },
        { id: 'p2', label: '普通 30m+3×30s', base: 1800000, period: 30000, count: 3 },
        { id: 'p3', label: '慢棋 60m+3×40s', base: 3600000, period: 40000, count: 3 }
    ]
};

const CQ_META = {
    chess: { title: '国际象棋', kind: 'fischer' },
    xq_a: { title: '中国象棋 A（增量）', kind: 'fischer' },
    xq_b: { title: '中国象棋 B（局时/步时/读秒）', kind: 'xq_b' },
    go: { title: '围棋', kind: 'go' }
};

const cq = {
    room: null,
    channel: null,
    players: [],
    presence: {},
    mySeat: -1,
    game: '',
    cfg: null,
    ready: {},
    started: false,
    over: false,
    winner: -1,
    reason: '',
    firstSeat: 0,
    turn: 0,
    turnStart: 0,
    clockOffset: 0,
    clocks: [0, 0],
    periods: [0, 0],
    score: [0, 0],
    seq: 0,
    state: null,
    selected: -1,
    legal: [],
    lastMove: null,
    resultWritten: false,
    tickTimer: null,
    pendingPromo: null
};

function cqKind() { return CQ_META[cq.game] ? CQ_META[cq.game].kind : 'fischer'; }
function cqOther(seat) { return seat === 0 ? 1 : 0; }
function cqFmt(ms) {
    const v = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
function cqSeatName(seat) {
    const p = cq.players.find(x => x.seat === seat);
    return p ? (p.display_name || '玩家') : `座位${seat + 1}`;
}
function cqIsHost() { return cq.mySeat === 0; }

function cqPresetOf(game, id) {
    const list = CQ_PRESETS[game] || [];
    return list.find(p => p.id === id) || list[1] || list[0];
}
function cqBuildCfg(game, presetId) {
    if (presetId === 'practice') return { kind: 'practice', practice: true, preset: 'practice' };
    // 中国象棋档位键带 a_/b_ 前缀，这里统一去掉后再查预设，但保留原始键用于高亮
    const id = String(presetId || '').replace(/^[ab]_/, '');
    const p = cqPresetOf(game, id);
    return { ...p, kind: CQ_META[game].kind, preset: presetId };
}

function cqIsCustomKey(key) {
    return key === 'custom' || key === 'a_custom' || key === 'b_custom';
}

// ---------- 自定义参数（建房处与房间内共用同一套解析/校验） ----------
function cqReadNum(id) {
    const el = document.getElementById(id);
    return el ? Number(el.value) : NaN;
}
function cqMakeCustomCfg(kind, v) {
    if (kind === 'fischer') {
        if (!(v.base > 0) || !(v.inc >= 0)) { alert('请填写有效的基础分钟与每步加秒'); return null; }
        return { kind, base: Math.round(v.base * 60000), inc: Math.round(v.inc * 1000), preset: 'custom' };
    }
    if (kind === 'xq_b') {
        if (!(v.game > 0) || !(v.move > 0) || !(v.byo > 0)) { alert('请填写有效的局时/步时/读秒'); return null; }
        return {
            kind, game: Math.round(v.game * 60000), move: Math.round(v.move * 60000),
            byo: Math.round(v.byo * 1000), preset: 'custom'
        };
    }
    if (kind === 'go') {
        if (!(v.base > 0) || !(v.period > 0) || !(v.count > 0)) { alert('请填写有效的保留时间/读秒/次数'); return null; }
        return {
            kind, base: Math.round(v.base * 60000), period: Math.round(v.period * 1000),
            count: Math.round(v.count), preset: 'custom'
        };
    }
    return null;
}
function cqReadInlineCfg(game) {
    const kind = CQ_META[game] ? CQ_META[game].kind : 'fischer';
    if (kind === 'fischer') {
        const p = game === 'chess' ? 'cqInlineChess' : 'cqInlineXqA';
        return cqMakeCustomCfg(kind, { base: cqReadNum(p + 'Base'), inc: cqReadNum(p + 'Inc') });
    }
    if (kind === 'xq_b') {
        return cqMakeCustomCfg(kind, {
            game: cqReadNum('cqInlineXqBGame'), move: cqReadNum('cqInlineXqBMove'), byo: cqReadNum('cqInlineXqBByo')
        });
    }
    if (kind === 'go') {
        return cqMakeCustomCfg(kind, {
            base: cqReadNum('cqInlineGoBase'), period: cqReadNum('cqInlineGoPeriod'), count: cqReadNum('cqInlineGoCount')
        });
    }
    return null;
}

// 建卡处选择「自定义」时展开对应输入项
function cqInlineToggle(game) {
    const sel = document.getElementById('cqPreset_' + game);
    const v = sel ? sel.value : '';
    const show = (id, on) => {
        const el = document.getElementById(id);
        if (el) el.style.display = on ? 'flex' : 'none';
    };
    if (game === 'xiangqi') {
        show('cqInline_xq_a', v === 'a_custom');
        show('cqInline_xq_b', v === 'b_custom');
        return;
    }
    show('cqInline_' + game, v === 'custom');
}

async function cqCreateRoom(game, presetId, btn) {
    if (!isAdmin) return;
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '创建中…'; }
    try {
        if (!dbClient || !currentUser) { alert('系统尚未加载完成，请稍后再试'); return; }
        const sel = document.getElementById('cqPreset_' + game);
        const chosen = presetId || (sel ? sel.value : 'p2');
        let cfg;
        if (cqIsCustomKey(chosen)) {
            cfg = cqReadInlineCfg(game);
            if (cfg) cfg.preset = chosen;
        } else {
            cfg = cqBuildCfg(game, chosen);
        }
        if (!cfg) return;
        localStorage.setItem('cq_cfg_' + game, JSON.stringify(cfg));

        try {
            await dbClient.from('game_rooms').delete().eq('host_id', currentUser.id).eq('game', game);
        } catch (e) { /* 无 delete 策略时忽略 */ }

        let lastError = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            const id = genUuid();
            const code = genRoomCode();
            const { error } = await dbClient.from('game_rooms').insert({
                id, code, game, host_id: currentUser.id, status: 'waiting'
            });
            if (!error) {
                await cqEnterRoom({ id, code, game, host_id: currentUser.id });
                return;
            }
            lastError = error;
            if (String(error.code) !== '23505') break;
        }

        if (lastError && String(lastError.code) === '23505') {
            const { data } = await dbClient.from('game_rooms').select('*')
                .eq('host_id', currentUser.id).eq('game', game).limit(1);
            if (data && data[0]) { await cqEnterRoom(data[0]); return; }
        }
        alert('创建房间失败：' + (lastError ? (lastError.message || lastError.code) : '未知错误'));
    } catch (e) {
        console.error('创建棋类房间异常', e);
        alert('创建房间失败：' + (e && e.message ? e.message : '网络异常，请重试'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = btnText || '创建房间'; }
    }
}

// 中国象棋：一张卡片内含 A（增量）/ B（局时步时读秒）两种档位
function cqCreateXiangqi(btn) {
    const sel = document.getElementById('cqPreset_xiangqi');
    const v = sel ? sel.value : 'a_p2';
    if (v === 'practice') return cqCreateRoom('xq_a', 'practice', btn);
    const isB = v.indexOf('b_') === 0;
    return cqCreateRoom(isB ? 'xq_b' : 'xq_a', v, btn);
}

async function cqJoinRoom(game, rawCode, btn) {
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '加入中…'; }
    try {
        const code = String(rawCode || '').trim().toUpperCase();
        if (!code) { alert('请输入房间号'); return; }
        if (!dbClient || !currentUser) { alert('系统尚未加载完成'); return; }
        const { data, error } = await dbClient.from('game_rooms').select('*').eq('code', code).limit(1);
        if (error) { alert('查询房间失败：' + (error.message || error.code)); return; }
        if (!data || !data[0]) { alert('房间不存在或已关闭'); return; }
        const room = data[0];
        // 中国象棋 A/B 共用一个房间，加入时两种模式都算匹配
        const isXq = g => g === 'xq_a' || g === 'xq_b' || g === 'xiangqi';
        const ok = isXq(game) ? isXq(room.game) : room.game === game;
        if (!ok) { alert('房间号与所选棋种不匹配'); return; }
        await cqEnterRoom(room);
    } catch (e) {
        console.error('加入棋类房间异常', e);
        alert('加入房间失败：' + (e && e.message ? e.message : '网络异常，请重试'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = btnText || '加入'; }
    }
}

async function cqEnterRoom(room) {
    cqLeaveRoom(true);
    cq.room = room;
    cq.game = room.game;
    try {
        const saved = JSON.parse(localStorage.getItem('cq_cfg_' + room.game) || 'null');
        cq.cfg = saved || cqBuildCfg(room.game, 'p2');
    } catch (e) {
        cq.cfg = cqBuildCfg(room.game, 'p2');
    }
    // 中国象棋 A/B 共用一个房间：按档位键恢复实际模式，并补齐旧数据的 a_/b_ 前缀
    if (room.game === 'xq_a' || room.game === 'xq_b') {
        const key = String((cq.cfg && cq.cfg.preset) || '');
        if (/^p\d$/.test(key)) cq.cfg.preset = (room.game === 'xq_b' ? 'b_' : 'a_') + key;
        else if (key.indexOf('b_') === 0) cq.game = 'xq_b';
        else if (key.indexOf('a_') === 0) cq.game = 'xq_a';
    }
    cqResetLocal();
    const seat = await cqEnsureSeat();
    if (seat === null) { cq.room = null; return; }
    cq.mySeat = seat;
    await cqReloadPlayers();
    cqOpenChannel();
    cqShowLayer();
    cqRenderAll();
}

function cqResetLocal() {
    cq.players = [];
    cq.presence = {};
    cq.ready = {};
    cq.started = false;
    cq.over = false;
    cq.winner = -1;
    cq.reason = '';
    cq.firstSeat = 0;
    cq.turn = 0;
    cq.turnStart = 0;
    cq.clocks = [0, 0];
    cq.periods = [0, 0];
    cq.score = [0, 0];
    cq.seq = 0;
    cq.state = null;
    cq.selected = -1;
    cq.legal = [];
    cq.lastMove = null;
    cq.resultWritten = false;
    cq.pendingPromo = null;
    if (cq.tickTimer) { clearInterval(cq.tickTimer); cq.tickTimer = null; }
}

async function cqEnsureSeat() {
    const { data: mine } = await dbClient.from('game_players').select('*')
        .eq('room_id', cq.room.id).eq('user_id', currentUser.id).maybeSingle();
    if (mine) return mine.seat;
    for (let attempt = 0; attempt < 6; attempt++) {
        const { data: rows } = await dbClient.from('game_players').select('seat').eq('room_id', cq.room.id);
        const seats = (rows || []).map(r => r.seat);
        if (seats.length >= 2) { alert('房间已满（棋类为双人对局）'); return null; }
        const seat = seats.includes(0) ? 1 : 0;
        const { error } = await dbClient.from('game_players').insert({
            room_id: cq.room.id, user_id: currentUser.id, display_name: myDisplayName(), seat
        });
        if (!error) return seat;
        if (String(error.code) !== '23505') { alert('加入房间失败：' + (error.message || error.code)); return null; }
    }
    return null;
}

async function cqReloadPlayers() {
    if (!cq.room) return;
    const { data } = await dbClient.from('game_players').select('*')
        .eq('room_id', cq.room.id).order('seat', { ascending: true });
    cq.players = data || [];
    cqRenderPlayers();
    cqRenderAll();
}

function cqOpenChannel() {
    if (!cq.room || !dbClient) return;
    const ch = dbClient.channel('room:' + cq.room.id, {
        config: { broadcast: { self: false }, presence: { key: currentUser.id } }
    });
    cq.channel = ch;

    ch.on('broadcast', { event: 'cq_cfg' }, ({ payload }) => cqApplyCfgPayload(payload));
    ch.on('broadcast', { event: 'cq_ready' }, ({ payload }) => {
        if (!payload || payload.seat === cq.mySeat) return;
        cq.ready[payload.seat] = true;
        cqRenderAll();
        cqTryStart();
    });
    ch.on('broadcast', { event: 'cq_start' }, ({ payload }) => cqApplyStart(payload));
    ch.on('broadcast', { event: 'cq_move' }, ({ payload }) => cqHandlePeerMove(payload));
    ch.on('broadcast', { event: 'cq_clock' }, ({ payload }) => {
        if (!payload) return;
        cq.clocks = payload.clocks || cq.clocks;
        cq.periods = payload.periods || cq.periods;
        cq.turnStart = Date.now();
        cqRenderClocks();
    });
    ch.on('broadcast', { event: 'cq_timeout' }, ({ payload }) => {
        if (payload) {
            cqApplyTimeout(payload.seat, payload.clocks, payload.periods,
                payload.draw, payload.winner, payload.reason);
        }
    });
    ch.on('broadcast', { event: 'cq_over' }, ({ payload }) => cqApplyOver(payload));
    ch.on('broadcast', { event: 'cq_resign' }, ({ payload }) => {
        if (!payload || cq.over) return;
        cqApplyOver({ winner: cqOther(payload.seat), reason: '认输', score: null });
    });
    ch.on('broadcast', { event: 'cq_pass' }, ({ payload }) => {
        if (!payload || cq.over) return;
        cqApplyGoPass(payload.seat, payload.state, false);
    });
    ch.on('broadcast', { event: 'cq_need_state' }, ({ payload }) => {
        if (!payload || payload.from === cq.mySeat) return;
        const lowest = cq.players.map(p => p.seat).sort((a, b) => a - b)[0];
        if (cq.mySeat === lowest) cqSend('cq_state', { snapshot: cqSnapshot() });
    });
    ch.on('broadcast', { event: 'cq_state' }, ({ payload }) => {
        if (payload && payload.snapshot) cqApplySnapshot(payload.snapshot);
    });
    ch.on('broadcast', { event: 'cq_player_leave' }, ({ payload }) => {
        if (payload && payload.seat !== undefined) delete cq.ready[payload.seat];
        cqReloadPlayers();
        if (cq.started && !cq.over) cqRenderStatus('对方已离开，对局结束');
    });
    ch.on('broadcast', { event: 'cq_room_closed' }, () => {
        alert('房主已关闭房间');
        cqLeaveRoom(true);
    });

    ch.on('presence', { event: 'sync' }, () => {
        cq.presence = ch.presenceState();
        cqRenderPlayers();
        cqRenderAll();
    });
    ch.on('presence', { event: 'join' }, ({ key }) => {
        if (key !== currentUser.id && cqIsHost()) {
            cqSend('cq_cfg', { cfg: cq.cfg, game: cq.game });
            cqSend('cq_state', { snapshot: cqSnapshot() });
        }
    });

    ch.subscribe(status => {
        if (status === 'SUBSCRIBED') {
            ch.track({ user_id: currentUser.id, name: myDisplayName(), seat: cq.mySeat });
            cqSend('cq_need_state', { from: cq.mySeat });
            if (!cq.tickTimer) cq.tickTimer = setInterval(cqTick, 250);
        }
    });
}

async function cqLeaveRoom(silent) {
    const room = cq.room, ch = cq.channel;
    if (!room) return;
    try {
        if (ch) {
            if (cqIsHost()) cqSend('cq_room_closed', {});
            else cqSend('cq_player_leave', { seat: cq.mySeat });
            await dbClient.removeChannel(ch);
        }
        if (cqIsHost()) {
            await dbClient.from('game_rooms').delete().eq('id', room.id);
        } else {
            await dbClient.from('game_players').delete().eq('room_id', room.id).eq('user_id', currentUser.id);
        }
    } catch (e) { console.warn('退出棋类房间清理失败', e); }

    cq.room = null;
    cq.channel = null;
    cqResetLocal();
    const layer = document.getElementById('chessRoomLayer');
    if (layer) layer.style.display = 'none';
    if (!silent) {
        const params = new URLSearchParams(location.search);
        if (params.get('game')) {
            history.replaceState(null, '', location.pathname);
        }
    }
}

function cqSend(event, payload) {
    if (cq.channel) {
        cq.channel.send({ type: 'broadcast', event, payload: payload || {} }).catch(() => {});
    }
}

// ---------- 开始 / 配置 ----------
function cqReady() {
    if (!cq.room) return;
    if (cq.players.length < 2) { alert('需要两名玩家才能开始'); return; }
    if (cq.started && !cq.over) { alert('对局进行中'); return; }
    if (cq.ready[cq.mySeat]) return;
    cq.ready[cq.mySeat] = true;
    cqSend('cq_ready', { seat: cq.mySeat });
    cqRenderAll();
    cqTryStart();
}

function cqTryStart() {
    if (cq.started && !cq.over) return;
    const seats = cq.players.map(p => p.seat).filter(s => s === 0 || s === 1);
    if (seats.length < 2 || !seats.every(s => cq.ready[s])) return;
    if (cq.mySeat !== Math.min(...seats)) return;
    const firstSeat = cq.over ? cqOther(cq.firstSeat) : cq.firstSeat;
    const payload = { cfg: cq.cfg, firstSeat, game: cq.game };
    cqSend('cq_start', payload);
    cqApplyStart(payload);
}

// 中国象棋 A/B 共用一个房间，允许在房间内切换；其他棋种不允许跨棋种切换
function cqAdoptGame(next) {
    if (!next || next === cq.game) return true;
    const family = ['xq_a', 'xq_b'];
    if (family.indexOf(next) >= 0 && family.indexOf(cq.game) >= 0) { cq.game = next; return true; }
    return false;
}

function cqApplyCfgPayload(payload) {
    if (!payload || !payload.cfg) return;
    cqAdoptGame(payload.game);
    cq.cfg = payload.cfg;
    if (!cq.started || cq.over) cqInitClocks(payload.cfg);
    cqRenderSetup();
    cqRenderAll();
}

function cqApplyStart(payload) {
    if (!payload || !cq.room) return;
    if (payload.game) cqAdoptGame(payload.game);
    if (payload.cfg) cq.cfg = payload.cfg;
    cq.firstSeat = payload.firstSeat === 1 ? 1 : 0;
    cq.started = true;
    cq.over = false;
    cq.winner = -1;
    cq.reason = '';
    cq.resultWritten = false;
    cq.ready = {};
    cq.selected = -1;
    cq.legal = [];
    cq.lastMove = null;
    cq.pendingPromo = null;
    cq.turn = cq.firstSeat;
    cq.turnStart = Date.now();
    cqInitClocks(cq.cfg || {});
    cq.seq++;
    cq.state = cq.game === 'go' ? GoEngine.initial()
        : cq.game === 'chess' ? ChessEngine.initial() : XiangqiEngine.initial();
    cqRenderAll();
}

// ---------- 房间内切换档位（仅房主、仅开局前或一局结束后） ----------
function cqCanChangeCfg() {
    if (!cqIsHost()) { alert('只有房主可以修改房间设置'); return false; }
    if (cq.started && !cq.over) { alert('对局进行中不能修改时间档位，请等本局结束后再改'); return false; }
    return true;
}

function cqSetCfg(cfg, game) {
    if (!cfg) return;
    if (game) cqAdoptGame(game);
    cq.cfg = cfg;
    const key = 'cq_cfg_' + ((cq.room && cq.room.game) || cq.game);
    try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ }
    // 开局前或一局结束后改档位，同步刷新双方的时钟显示
    if (!cq.started || cq.over) cqInitClocks(cfg);
    cqSend('cq_cfg', { cfg, game: cq.game });
    cqRenderSetup();
    cqRenderAll();
}

function cqInitClocks(cfg) {
    const kind = cqKind();
    if (cfg.practice) {
        cq.clocks = [0, 0];
        cq.periods = [0, 0];
    } else if (kind === 'go') {
        cq.clocks = [cfg.base || 0, cfg.base || 0];
        cq.periods = [cfg.count || 3, cfg.count || 3];
    } else if (kind === 'xq_b') {
        cq.clocks = [cfg.game || 0, cfg.game || 0];
        cq.periods = [1, 1];
    } else {
        cq.clocks = [cfg.base || 0, cfg.base || 0];
        cq.periods = [0, 0];
    }
}

function cqTogglePresetPanel(force) {
    const panel = document.getElementById('cqPresetPanel');
    if (!panel) return;
    const show = typeof force === 'boolean' ? force : panel.style.display === 'none';
    panel.style.display = show ? 'block' : 'none';
}

// 房间内可选档位：中国象棋同时列出 A/B 两套，其他棋种列出自身预设
function cqPresetChipList() {
    const list = [];
    if (cq.game === 'xq_a' || cq.game === 'xq_b') {
        CQ_PRESETS.xq_a.forEach(p => list.push({ key: 'a_' + p.id, label: 'A ' + p.label }));
        CQ_PRESETS.xq_b.forEach(p => list.push({ key: 'b_' + p.id, label: 'B ' + p.label }));
    } else {
        (CQ_PRESETS[cq.game] || []).forEach(p => list.push({ key: p.id, label: p.label }));
    }
    list.push({ key: 'custom', label: '自定义' });
    list.push({ key: 'practice', label: '不限时练习' });
    return list;
}

function cqApplyPresetChip(key) {
    if (!cqCanChangeCfg()) return;
    if (key === 'custom') {
        cqTogglePresetPanel(true);
        const el = document.getElementById('cqCfgBase') || document.getElementById('cqCfgGame')
            || document.getElementById('cqCfgGoBase');
        if (el) el.focus();
        return;
    }
    if (key === 'practice') {
        cqSetCfg({ kind: 'practice', practice: true, preset: 'practice' });
        return;
    }
    const m = /^([ab])_p\d$/.exec(key);
    if (m && cq.game !== 'xq_a' && cq.game !== 'xq_b') return;
    const game = m ? (m[1] === 'a' ? 'xq_a' : 'xq_b') : cq.game;
    cqSetCfg(cqBuildCfg(game, key), game);
}

function cqApplyCustom() {
    if (!cqCanChangeCfg()) return;
    const cfg = cqReadCustomCfg();
    if (!cfg) return;
    if (cq.game === 'xq_a' || cq.game === 'xq_b') {
        cfg.preset = cq.game === 'xq_b' ? 'b_custom' : 'a_custom';
    }
    cqSetCfg(cfg);
}

function cqReadCustomCfg() {
    const kind = cqKind();
    if (kind === 'fischer') {
        return cqMakeCustomCfg(kind, { base: cqReadNum('cqCfgBase'), inc: cqReadNum('cqCfgInc') });
    }
    if (kind === 'xq_b') {
        return cqMakeCustomCfg(kind, {
            game: cqReadNum('cqCfgGame'), move: cqReadNum('cqCfgMove'), byo: cqReadNum('cqCfgByo')
        });
    }
    if (kind === 'go') {
        return cqMakeCustomCfg(kind, {
            base: cqReadNum('cqCfgGoBase'), period: cqReadNum('cqCfgGoPeriod'), count: cqReadNum('cqCfgGoCount')
        });
    }
    return null;
}

// ---------- 时钟 ----------
function cqElapsed() {
    if (!cq.turnStart) return 0;
    return Math.max(0, Date.now() - cq.turnStart);
}
function cqRemaining(seat) {
    if (!cq.cfg || cq.cfg.practice) return Infinity;
    const kind = cqKind();
    const live = (seat === cq.turn) ? cqElapsed() : 0;
    if (kind === 'fischer') return Math.max(0, cq.clocks[seat] - live);
    if (kind === 'xq_b') {
        if (cq.clocks[seat] > 0) return Math.max(0, cq.clocks[seat] - live);
        return Math.max(0, (cq.cfg.byo || 0) - live);
    }
    if (kind === 'go') {
        if (cq.clocks[seat] > 0) return Math.max(0, cq.clocks[seat] - live);
        const period = cq.cfg.period || 0;
        const consumed = Math.floor(live / (period || 1));
        const left = (cq.periods[seat] || 0) - consumed;
        if (left <= 0) return 0;
        return period - (live % period);
    }
    return Math.max(0, cq.clocks[seat] - live);
}

function cqApplyElapsedTo(mover) {
    if (!cq.cfg || cq.cfg.practice) return;
    const elapsed = cqElapsed();
    const kind = cqKind();
    if (kind === 'fischer') {
        cq.clocks[mover] = Math.max(0, cq.clocks[mover] - elapsed) + (cq.cfg.inc || 0);
    } else if (kind === 'xq_b') {
        if (cq.clocks[mover] > 0) cq.clocks[mover] = Math.max(0, cq.clocks[mover] - elapsed);
        else cq.periods[mover] = Math.max(0, cq.periods[mover] - Math.floor(elapsed / (cq.cfg.byo || 1)));
    } else if (kind === 'go') {
        if (cq.clocks[mover] > 0) cq.clocks[mover] = Math.max(0, cq.clocks[mover] - elapsed);
        else cq.periods[mover] = Math.max(0, cq.periods[mover] - Math.floor(elapsed / (cq.cfg.period || 1)));
    }
}

function cqTick() {
    if (!cq.room || !cq.started || cq.over || !cq.cfg || cq.cfg.practice) return;
    const seat = cq.turn, el = cqElapsed(), kind = cqKind();
    if (kind === 'fischer') {
        if (cq.clocks[seat] - el <= 0) cqDeclareTimeout(seat);
    } else if (kind === 'xq_b') {
        if (cq.clocks[seat] > 0) {
            if (el >= (cq.cfg.move || 0)) cqDeclareTimeout(seat);
            else if (el >= cq.clocks[seat]) {
                cq.turnStart += cq.clocks[seat];
                cq.clocks[seat] = 0;
                cq.periods[seat] = 1;
                cqSend('cq_clock', { clocks: cq.clocks, periods: cq.periods });
            }
        } else if (el >= (cq.cfg.byo || 0)) {
            cqDeclareTimeout(seat);
        }
    } else if (kind === 'go') {
        if (cq.clocks[seat] > 0) {
            if (el >= cq.clocks[seat]) {
                cq.turnStart += cq.clocks[seat];
                cq.clocks[seat] = 0;
                cq.periods[seat] = cq.cfg.count || 3;
                cqSend('cq_clock', { clocks: cq.clocks, periods: cq.periods });
            }
        } else {
            const used = Math.floor(el / (cq.cfg.period || 1));
            if ((cq.periods[seat] || 0) - used <= 0) cqDeclareTimeout(seat);
        }
    }
    cqRenderClocks();
}

function cqDeclareTimeout(seat) {
    if (cq.over) return;
    let winner = cqOther(seat), reason = '超时判负', draw = false;
    if (cq.game === 'chess' && cq.state) {
        const oppColor = cqSeatColor(cqOther(seat));
        if (ChessEngine.insufficient(oppColor, cq.state)) { draw = true; winner = -1; reason = '超时但对方无将杀子力，判和'; }
    }
    cqSend('cq_timeout', { seat, clocks: cq.clocks, periods: cq.periods, draw, winner, reason });
    cqApplyTimeout(seat, cq.clocks, cq.periods, draw, winner, reason);
}

function cqApplyTimeout(seat, clocks, periods, draw, winner, reason) {
    if (cq.over) return;
    if (clocks) cq.clocks = clocks;
    if (periods) cq.periods = periods;
    if (winner === undefined || winner === null) winner = cqOther(seat);
    if (draw) winner = -1;
    cqApplyOver({ winner, reason: reason || '超时判负', score: null });
}

function cqSeatColor(seat) {
    const first = cq.firstSeat === 1 ? 1 : 0;
    const isFirst = seat === first;
    if (cq.game === 'chess' || cq.game === 'go') return isFirst ? 'w' : 'b';
    return isFirst ? XiangqiEngine.RED : XiangqiEngine.BLACK;
}

// ---------- 走子同步 ----------
function cqCommitLocalMove(move) {
    if (!cq.started || cq.over) return;
    const seat = cq.mySeat;
    if (seat !== cq.turn) return;
    let nextState = null;
    if (cq.game === 'go') {
        const r = GoEngine.play(cq.state, move.idx);
        if (!r.ok) { alert(r.error); return; }
        nextState = r.state;
    } else {
        const mv = cqFindLegal(move);
        if (!mv) return;
        nextState = cq.game === 'chess' ? ChessEngine.apply(cq.state, mv) : XiangqiEngine.apply(cq.state, mv);
    }
    cqApplyElapsedTo(seat);
    cq.state = nextState;
    cq.lastMove = move;
    cq.selected = -1;
    cq.legal = [];
    cq.over = false;
    cq.turn = cqOther(seat);
    cq.turnStart = Date.now();
    cq.seq++;
    cqSend('cq_move', {
        seq: cq.seq, seat, move,
        clocks: cq.clocks, periods: cq.periods
    });
    cqAfterMove(seat);
}

function cqHandlePeerMove(payload) {
    if (!payload || !cq.started || cq.over) return;
    if (payload.seat !== cq.turn) { cqSend('cq_need_state', { from: cq.mySeat }); return; }
    try {
        let next = null;
        if (cq.game === 'go') {
            const r = GoEngine.play(cq.state, payload.move.idx);
            if (!r.ok) throw new Error(r.error);
            next = r.state;
        } else {
            const mv = cqFindLegal(payload.move);
            if (!mv) throw new Error('非法走子');
            next = cq.game === 'chess' ? ChessEngine.apply(cq.state, mv) : XiangqiEngine.apply(cq.state, mv);
        }
        cq.state = next;
        cq.lastMove = payload.move;
        cq.selected = -1;
        cq.legal = [];
        if (payload.clocks) cq.clocks = payload.clocks;
        if (payload.periods) cq.periods = payload.periods;
        cq.seq = payload.seq || cq.seq + 1;
        cq.turn = cqOther(payload.seat);
        cq.turnStart = Date.now();
        cqAfterMove(payload.seat);
    } catch (e) {
        console.warn('收到非法走子，请求状态', e);
        cqSend('cq_need_state', { from: cq.mySeat });
    }
}

function cqAfterMove(mover) {
    cq.selected = -1;
    cq.legal = [];
    if (cq.game === 'chess') {
        const st = ChessEngine.status(cq.state);
        if (st === 'checkmate') return cqFinishGame(mover, '将杀');
        if (st === 'stalemate') return cqFinishGame(-1, '逼和');
        cqRenderAll(st === 'check' ? '将军！' : '');
        return;
    }
    if (cq.game === 'xq_a' || cq.game === 'xq_b') {
        const st = XiangqiEngine.status(cq.state);
        if (st === 'checkmate') return cqFinishGame(mover, '将杀');
        if (st === 'stalemate') return cqFinishGame(mover, '困毙');
        cqRenderAll(st === 'check' ? '将军！' : '');
        return;
    }
    cqRenderAll();
}

function cqFindLegal(move) {
    const color = cq.game === 'chess' ? cqSeatColor(cq.turn) : (cq.turn === cq.firstSeat ? XiangqiEngine.RED : XiangqiEngine.BLACK);
    const list = cq.game === 'chess' ? ChessEngine.legalMoves(cq.state, color) : XiangqiEngine.legalMoves(cq.state, color);
    return list.find(m => m.from === move.from && m.to === move.to &&
        (move.promo ? m.promo === move.promo : true)) || null;
}

function cqFinishGame(winner, reason) {
    if (cq.over) return;
    if (winner === 0 || winner === 1) cq.score[winner]++;
    cqApplyOver({ winner, reason, score: cq.score.slice() });
    if (cqIsHost()) cqPersistResult(winner, reason);
    cqSend('cq_over', { winner, reason, score: cq.score.slice() });
}

function cqApplyOver(payload) {
    if (!payload || cq.over) return;
    cq.over = true;
    cq.winner = payload.winner === 0 || payload.winner === 1 ? payload.winner : -1;
    cq.reason = payload.reason || '';
    if (Array.isArray(payload.score)) cq.score = payload.score;
    cq.ready = {};
    cqRenderAll();
}

function cqPersistResult(winner, reason) {
    if (!cq.room || cq.resultWritten) return;
    cq.resultWritten = true;
    dbClient.from('game_rooms').update({
        status: 'finished',
        result: {
            game: cq.game, winner, reason, score: cq.score.slice(),
            moves: cq.state && cq.state.moves ? cq.state.moves : (cq.state && cq.state.board ? cq.seq : 0),
            at: new Date().toISOString()
        }
    }).eq('id', cq.room.id).then(() => {}).catch(() => {});
}

function cqResign() {
    if (!cq.started || cq.over) return;
    if (!window.confirm('确定认输吗？')) return;
    cqFinishGame(cqOther(cq.mySeat), '认输');
}

// ---------- 围棋 Pass / 终局 ----------
function cqGoPass() {
    if (cq.game !== 'go' || !cq.started || cq.over || cq.mySeat !== cq.turn) return;
    const r = GoEngine.pass(cq.state);
    cqApplyElapsedTo(cq.mySeat);
    cq.state = r.state;
    cq.turn = cqOther(cq.mySeat);
    cq.turnStart = Date.now();
    cq.seq++;
    cq.lastMove = null;
    cqSend('cq_pass', { seat: cq.mySeat, seq: cq.seq, state: { passes: r.state.passes, captures: r.state.captures, prevBoard: r.state.prevBoard } });
    cqRenderAll('停一手');
    if (r.ended) cqFinishGoByScore();
}

function cqApplyGoPass(seat, partial, broadcast) {
    if (cq.game !== 'go' || !cq.started || cq.over) return;
    if (seat === cq.mySeat && !broadcast) return;
    const r = GoEngine.pass(cq.state);
    cq.state = r.state;
    cq.turn = cqOther(seat);
    cq.turnStart = Date.now();
    cq.selected = -1;
    cqRenderAll('对方停一手');
    if (r.ended) cqFinishGoByScore();
}

function cqFinishGoByScore() {
    const sc = GoEngine.score(cq.state);
    let winner = -1;
    if (sc.black > sc.white) winner = cq.firstSeat;
    else if (sc.white > sc.black) winner = cqOther(cq.firstSeat);
    const reason = `数子：黑 ${sc.black} 目，白 ${sc.white} 目（含贴目 7.5）`;
    if (winner >= 0) cq.score[winner]++;
    cqApplyOver({ winner, reason, score: cq.score.slice() });
    if (cqIsHost()) cqPersistResult(winner, reason);
    cqSend('cq_over', { winner, reason, score: cq.score.slice() });
}

// ---------- 状态快照 ----------
function cqSnapshot() {
    return {
        game: cq.game, cfg: cq.cfg, started: cq.started, over: cq.over,
        winner: cq.winner, reason: cq.reason, firstSeat: cq.firstSeat,
        turn: cq.turn, clocks: cq.clocks, periods: cq.periods,
        score: cq.score, seq: cq.seq, state: cq.state, lastMove: cq.lastMove
    };
}

function cqApplySnapshot(s) {
    if (!s) return;
    if (s.game !== cq.game && !cqAdoptGame(s.game)) return;
    if (s.seq < cq.seq && cq.started) return;
    cq.cfg = s.cfg || cq.cfg;
    cq.started = !!s.started;
    cq.over = !!s.over;
    cq.winner = s.winner === 0 || s.winner === 1 ? s.winner : -1;
    cq.reason = s.reason || '';
    cq.firstSeat = s.firstSeat === 1 ? 1 : 0;
    cq.turn = s.turn === 1 ? 1 : 0;
    cq.clocks = Array.isArray(s.clocks) ? s.clocks.slice() : cq.clocks;
    cq.periods = Array.isArray(s.periods) ? s.periods.slice() : cq.periods;
    cq.score = Array.isArray(s.score) ? s.score.slice() : cq.score;
    cq.seq = s.seq || 0;
    cq.state = s.state;
    cq.lastMove = s.lastMove || null;
    cq.turnStart = Date.now();
    cqRenderAll();
}

// ---------- 渲染 ----------
function cqShowLayer() {
    const layer = document.getElementById('chessRoomLayer');
    if (!layer) return;
    layer.style.display = 'flex';
    const title = document.getElementById('cqTitle');
    if (title) title.textContent = CQ_META[cq.game] ? CQ_META[cq.game].title : '棋类对局';
    const code = document.getElementById('cqCode');
    if (code) code.textContent = cq.room ? cq.room.code : '';
    cqRenderSetup();
    cqRenderPlayers();
    cqRenderAll();
}

function cqRenderSetup() {
    const bar = document.getElementById('cqSetup');
    if (!bar) return;
    const cfg = cq.cfg || {};
    const isPractice = !!cfg.practice;
    const fields = document.getElementById('cqCfgFields');
    const kind = cqKind();
    const titleEl = document.getElementById('cqTitle');
    if (titleEl) titleEl.textContent = CQ_META[cq.game] ? CQ_META[cq.game].title : '棋类对局';

    // 档位标签：点击展开档位面板
    let html = '';
    if (!isPractice) {
        if (kind === 'fischer') {
            html = `<label>基础(分钟)<input type="number" id="cqCfgBase" min="1" step="1" value="${(cfg.base || 0) / 60000}"></label>
                    <label>每步加秒<input type="number" id="cqCfgInc" min="0" step="1" value="${(cfg.inc || 0) / 1000}"></label>`;
        } else if (kind === 'xq_b') {
            html = `<label>局时(分钟)<input type="number" id="cqCfgGame" min="1" step="1" value="${(cfg.game || 0) / 60000}"></label>
                    <label>步时(分钟)<input type="number" id="cqCfgMove" min="1" step="1" value="${(cfg.move || 0) / 60000}"></label>
                    <label>读秒(秒)<input type="number" id="cqCfgByo" min="5" step="5" value="${(cfg.byo || 0) / 1000}"></label>`;
        } else {
            html = `<label>保留(分钟)<input type="number" id="cqCfgGoBase" min="1" step="1" value="${(cfg.base || 0) / 60000}"></label>
                    <label>读秒(秒)<input type="number" id="cqCfgGoPeriod" min="5" step="5" value="${(cfg.period || 0) / 1000}"></label>
                    <label>读秒次数<input type="number" id="cqCfgGoCount" min="1" step="1" value="${cfg.count || 3}"></label>`;
        }
    }
    fields.innerHTML = html;
    const label = document.getElementById('cqCfgLabel');
    if (label) {
        label.textContent = isPractice ? '不限时练习房：不计时、不判超时' :
            (kind === 'fischer' ? `增量计时：基础 ${(cfg.base || 0) / 60000} 分 + 每步 ${(cfg.inc || 0) / 1000} 秒`
                : kind === 'xq_b' ? `局时 ${(cfg.game || 0) / 60000} 分 / 步时 ${(cfg.move || 0) / 60000} 分 / 读秒 ${(cfg.byo || 0) / 1000} 秒`
                    : `保留 ${(cfg.base || 0) / 60000} 分 + ${cfg.count || 3}×${(cfg.period || 0) / 1000} 秒读秒`);
    }

    let activeKey = isPractice ? 'practice' : String(cfg.preset || '');
    if (cqIsCustomKey(activeKey)) activeKey = 'custom';
    const chips = document.getElementById('cqPresetChips');
    if (chips) {
        chips.innerHTML = cqPresetChipList().map(item =>
            `<button type="button" class="cq-chip${item.key === activeKey ? ' active' : ''}"
                onclick="cqApplyPresetChip('${item.key}')">${item.label}</button>`).join('');
    }

    const applyBtn = document.getElementById('cqApplyBtn');
    if (applyBtn) applyBtn.style.display = cqIsHost() ? '' : 'none';
    const inputs = fields.querySelectorAll('input');
    inputs.forEach(inp => { inp.disabled = !cqIsHost(); });
    const startBtn = document.getElementById('cqStartBtn');
    if (startBtn) {
        startBtn.disabled = cq.players.length < 2;
        startBtn.textContent = cq.ready[cq.mySeat] && !cq.started ? '已准备，等待对方…'
            : (cq.over ? '再来一局' : '开始游戏');
    }
}

function cqRenderPlayers() {
    const box = document.getElementById('cqPlayers');
    if (!box) return;
    const mine = cq.players.find(p => p.seat === cq.mySeat);
    const opp = cq.players.find(p => p.seat !== cq.mySeat);
    const chip = (p, label) => {
        if (!p) return `<span class="room-player-chip">${label}：等待加入</span>`;
        return `<span class="room-player-chip online">${label}：${p.display_name || '玩家'}${p.seat === cq.mySeat ? '（我）' : ''}</span>`;
    };
    box.innerHTML = chip(mine, '我方') + chip(opp, '对方');
}

function cqRenderClocks() {
    const el = document.getElementById('cqClocks');
    if (!el) return;
    if (!cq.cfg || cq.cfg.practice) { el.textContent = '练习房 · 不计时'; return; }
    const kind = cqKind();
    const side = seat => {
        const name = seat === cq.mySeat ? '我方' : '对方';
        if (kind === 'fischer') return `${name} ${cqFmt(cqRemaining(seat))}`;
        if (kind === 'xq_b') {
            const turnElapsed = cq.turn === seat ? cqElapsed() : 0;
            if (cq.clocks[seat] > 0) {
                const main = Math.max(0, cq.clocks[seat] - turnElapsed);
                const step = Math.max(0, (cq.cfg.move || 0) - turnElapsed);
                return `${name} 局时 ${cqFmt(main)} · 步时 ${cqFmt(step)}`;
            }
            return `${name} 读秒 ${Math.max(0, Math.ceil(cqRemaining(seat) / 1000))}s`;
        }
        if (cq.clocks[seat] > 0) return `${name} ${cqFmt(cqRemaining(seat))}`;
        const period = cq.cfg.period || 1;
        const used = Math.floor((cq.turn === seat ? cqElapsed() : 0) / period);
        const left = Math.max(0, (cq.periods[seat] || 0) - used);
        return `${name} 读秒 ${Math.max(0, Math.ceil(cqRemaining(seat) / 1000))}s (${left}次)`;
    };
    el.textContent = side(cq.mySeat >= 0 ? cq.mySeat : 0) + '　|　' + side(cq.mySeat >= 0 ? cqOther(cq.mySeat) : 1);
}

function cqRenderStatus(extra) {
    const el = document.getElementById('cqStatus');
    if (!el) return;
    const scoreEl = document.getElementById('cqScore');
    if (scoreEl) {
        const mine = cq.score[cq.mySeat >= 0 ? cq.mySeat : 0] || 0;
        const opp = cq.score[cq.mySeat >= 0 ? cqOther(cq.mySeat) : 1] || 0;
        scoreEl.textContent = `比分 我 ${mine} : ${opp} 对方`;
    }
    let text;
    if (!cq.players.length) text = '等待玩家加入';
    else if (cq.players.length < 2) text = '等待对手加入（复制邀请链接发给对方）';
    else if (!cq.started) text = cq.ready[cq.mySeat] ? '已准备，等待对方点击「开始游戏」…' : '双方点击「开始游戏」后开始对局';
    else if (cq.over) {
        text = cq.winner === -1 ? `对局结束：和棋${cq.reason ? '（' + cq.reason + '）' : ''}`
            : `对局结束：${cq.winner === cq.mySeat ? '你' : '对方'}获胜${cq.reason ? '（' + cq.reason + '）' : ''}`;
    } else {
        const myTurn = cq.turn === cq.mySeat;
        text = myTurn ? '轮到你走棋' : `等待${cqSeatName(cq.turn)}走棋`;
        if (cq.game === 'go') text += `　已提子 黑 ${cq.state.captures[0]} / 白 ${cq.state.captures[1]}`;
    }
    if (extra) text += '　' + extra;
    el.textContent = text;

    const passBtn = document.getElementById('cqPassBtn');
    if (passBtn) passBtn.style.display = cq.game === 'go' && cq.started && !cq.over ? '' : 'none';
    const resignBtn = document.getElementById('cqResignBtn');
    if (resignBtn) resignBtn.style.display = cq.started && !cq.over ? '' : 'none';
}

function cqRenderAll(extra) {
    cqRenderPlayers();
    cqRenderStatus(extra);
    cqRenderClocks();
    cqRenderSetup();
    cqDrawBoard();
    cqRenderPromo();
}

// ---------- 棋盘绘制 ----------
function cqFlip() { return cq.mySeat === 1; }

function cqDrawBoard() {
    const canvas = document.getElementById('cqCanvas');
    if (!canvas || !cq.state) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (cq.game === 'chess') cqDrawChess(ctx, W, H);
    else if (cq.game === 'go') cqDrawGo(ctx, W, H);
    else cqDrawXiangqi(ctx, W, H);
}

function cqDrawChess(ctx, W, H) {
    const pad = 30, size = (W - pad * 2) / 8;
    const board = cq.state.board;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const dr = cqFlip() ? 7 - r : r, dc = cqFlip() ? 7 - c : c;
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f0d9b5' : '#b58863';
        ctx.fillRect(pad + dc * size, pad + dr * size, size, size);
    }
    const sel = cq.selected;
    if (sel >= 0) {
        const r = Math.floor(sel / 8), c = sel % 8;
        const dr = cqFlip() ? 7 - r : r, dc = cqFlip() ? 7 - c : c;
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 4;
        ctx.strokeRect(pad + dc * size + 2, pad + dr * size + 2, size - 4, size - 4);
    }
    cq.legal.forEach(m => {
        const r = Math.floor(m.to / 8), c = m.to % 8;
        const dr = cqFlip() ? 7 - r : r, dc = cqFlip() ? 7 - c : c;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(52,152,219,0.45)';
        ctx.arc(pad + dc * size + size / 2, pad + dr * size + size / 2, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
    });
    if (cq.lastMove && cq.lastMove.to !== undefined) {
        const r = Math.floor(cq.lastMove.to / 8), c = cq.lastMove.to % 8;
        const dr = cqFlip() ? 7 - r : r, dc = cqFlip() ? 7 - c : c;
        ctx.strokeStyle = 'rgba(231,76,60,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(pad + dc * size + 3, pad + dr * size + 3, size - 6, size - 6);
    }
    const glyphs = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(size * 0.72)}px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif`;
    for (let i = 0; i < 64; i++) {
        const p = board[i];
        if (!p) continue;
        const r = Math.floor(i / 8), c = i % 8;
        const dr = cqFlip() ? 7 - r : r, dc = cqFlip() ? 7 - c : c;
        const x = pad + dc * size + size / 2;
        const y = pad + dr * size + size / 2 + 2;
        ctx.fillStyle = p[0] === 'w' ? '#fff' : '#1a1a1a';
        ctx.strokeStyle = p[0] === 'w' ? '#333' : '#000';
        ctx.lineWidth = 2;
        ctx.fillText(glyphs[p[1]], x, y);
        ctx.strokeText(glyphs[p[1]], x, y);
    }
}

function cqDrawXiangqi(ctx, W, H) {
    const pad = 40;
    const cell = Math.min((W - pad * 2) / 8, (H - pad * 2) / 9);
    const bx = (W - cell * 8) / 2, by = (H - cell * 9) / 2;
    const pos = (r, c) => {
        const rr = cqFlip() ? 9 - r : r, cc = cqFlip() ? 8 - c : c;
        return [bx + cc * cell, by + rr * cell];
    };
    ctx.fillStyle = '#f7e3bd';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8a6b3f';
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 10; r++) {
        const [x1, y1] = pos(r, 0), [x2] = pos(r, 8);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
    }
    for (let c = 0; c < 9; c++) {
        if (c === 0 || c === 8) {
            const [x1, y1] = pos(0, c), [, y2] = pos(9, c);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y2); ctx.stroke();
        } else {
            const [x1, y1] = pos(0, c), [, y2] = pos(4, c);
            const [, y3] = pos(5, c), [, y4] = pos(9, c);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x1, y3); ctx.lineTo(x1, y4); ctx.stroke();
        }
    }
    ctx.strokeStyle = 'rgba(138,107,63,0.7)';
    [[0, 3], [0, 5], [9, 3], [9, 5]].forEach(([r, c]) => {
        const [x, y] = pos(r, c);
        const d = cell * 0.18;
        const dx = c === 3 ? d : -d;
        const dy = r === 0 ? d : -d;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y); ctx.lineTo(x + dx * 0.6, y + dy * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + dy); ctx.lineTo(x + dx * 0.6, y + dy * 0.6); ctx.stroke();
    });
    ctx.fillStyle = '#8a6b3f';
    ctx.font = `${Math.floor(cell * 0.42)}px "KaiTi", "STKaiti", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [mx1, my1] = pos(4, 1), [mx2] = pos(4, 7);
    ctx.fillText('楚 河', (mx1 + mx2) / 2 - cell * 0.9, my1 + cell / 2);
    ctx.fillText('汉 界', (mx1 + mx2) / 2 + cell * 0.9, my1 + cell / 2);

    const chars = {
        r: { K: '帅', A: '仕', E: '相', H: '马', R: '车', C: '炮', P: '兵' },
        b: { K: '将', A: '士', E: '象', H: '马', R: '车', C: '炮', P: '卒' }
    };
    for (let i = 0; i < 90; i++) {
        const p = cq.state.board[i];
        if (!p) continue;
        const r = Math.floor(i / 9), c = i % 9;
        const [x, y] = pos(r, c);
        ctx.beginPath();
        ctx.fillStyle = '#fff7e6';
        ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p[0] === 'r' ? '#c0392b' : '#2c3e50';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = p[0] === 'r' ? '#c0392b' : '#2c3e50';
        ctx.font = `bold ${Math.floor(cell * 0.5)}px "KaiTi", "STKaiti", serif`;
        ctx.fillText(chars[p[0]][p[1]], x, y + 1);
    }
    if (cq.selected >= 0) {
        const r = Math.floor(cq.selected / 9), c = cq.selected % 9;
        const [x, y] = pos(r, c);
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, cell * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
    cq.legal.forEach(m => {
        const r = Math.floor(m.to / 9), c = m.to % 9;
        const [x, y] = pos(r, c);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(52,152,219,0.5)';
        ctx.arc(x, y, cell * 0.12, 0, Math.PI * 2);
        ctx.fill();
    });
    if (cq.lastMove && cq.lastMove.to !== undefined) {
        const r = Math.floor(cq.lastMove.to / 9), c = cq.lastMove.to % 9;
        const [x, y] = pos(r, c);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - cell * 0.44, y - cell * 0.44, cell * 0.88, cell * 0.88);
    }
}

function cqDrawGo(ctx, W, H) {
    const pad = 36;
    const size = 19;
    const cell = (W - pad * 2) / (size - 1);
    const pos = i => {
        const r = Math.floor(i / size), c = i % size;
        const rr = cqFlip() ? size - 1 - r : r, cc = cqFlip() ? size - 1 - c : c;
        return [pad + cc * cell, pad + rr * cell];
    };
    ctx.fillStyle = '#e8c48c';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#6b4f2a';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
        const y = pad + i * cell, x = pad + i * cell;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, H - pad); ctx.stroke();
    }
    ctx.fillStyle = '#6b4f2a';
    [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]].forEach(([r, c]) => {
        const rr = cqFlip() ? size - 1 - r : r, cc = cqFlip() ? size - 1 - c : c;
        ctx.beginPath();
        ctx.arc(pad + cc * cell, pad + rr * cell, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    for (let i = 0; i < cq.state.board.length; i++) {
        const v = cq.state.board[i];
        if (!v) continue;
        const [x, y] = pos(i);
        const grad = ctx.createRadialGradient(x - cell * 0.18, y - cell * 0.18, cell * 0.1, x, y, cell * 0.46);
        if (v === 1) { grad.addColorStop(0, '#666'); grad.addColorStop(1, '#000'); }
        else { grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#d8d8d8'); }
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(x, y, cell * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = v === 1 ? '#000' : '#999';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    if (cq.state.lastMove >= 0) {
        const [x, y] = pos(cq.state.lastMove);
        ctx.beginPath();
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2;
        ctx.arc(x, y, cell * 0.2, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// ---------- 点击落子 ----------
function cqCanvasClick(e) {
    if (!cq.started || cq.over || !cq.state) return;
    if (cq.turn !== cq.mySeat) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const W = canvas.width;

    if (cq.game === 'go') {
        const pad = 36, cell = (W - pad * 2) / 18;
        let c = Math.round((x - pad) / cell), r = Math.round((y - pad) / cell);
        if (r < 0 || r > 18 || c < 0 || c > 18) return;
        if (cqFlip()) { r = 18 - r; c = 18 - c; }
        cqCommitLocalMove({ idx: r * 19 + c });
        return;
    }
    if (cq.game === 'chess') {
        const pad = 30, cell = (W - pad * 2) / 8;
        let c = Math.floor((x - pad) / cell), r = Math.floor((y - pad) / cell);
        if (r < 0 || r > 7 || c < 0 || c > 7) return;
        if (cqFlip()) { r = 7 - r; c = 7 - c; }
        cqHandleBoardPoint(r * 8 + c);
        return;
    }
    const pad = 40;
    const cell = Math.min((W - pad * 2) / 8, (canvas.height - pad * 2) / 9);
    const bx = (W - cell * 8) / 2, by = (canvas.height - cell * 9) / 2;
    let c = Math.round((x - bx) / cell), r = Math.round((y - by) / cell);
    if (r < 0 || r > 9 || c < 0 || c > 8) return;
    if (cqFlip()) { r = 9 - r; c = 8 - c; }
    cqHandleBoardPoint(r * 9 + c);
}

function cqHandleBoardPoint(point) {
    const piece = cq.state.board[point];
    const color = cq.game === 'chess' ? cqSeatColor(cq.turn) : (cq.turn === cq.firstSeat ? XiangqiEngine.RED : XiangqiEngine.BLACK);
    const mine = piece && piece[0] === color;
    if (cq.selected < 0 || mine) {
        if (!mine) return;
        cq.selected = point;
        const all = cq.game === 'chess' ? ChessEngine.legalMoves(cq.state, color) : XiangqiEngine.legalMoves(cq.state, color);
        cq.legal = all.filter(m => m.from === point);
        cqDrawBoard();
        return;
    }
    const candidates = cq.legal.filter(m => m.to === point);
    if (!candidates.length) {
        cq.selected = -1;
        cq.legal = [];
        cqDrawBoard();
        return;
    }
    if (candidates.length > 1 && candidates[0].promo) {
        cq.pendingPromo = { from: cq.selected, to: point };
        cqRenderPromo();
        return;
    }
    cqCommitLocalMove({ from: cq.selected, to: point, promo: candidates[0].promo || null });
}

function cqRenderPromo() {
    const box = document.getElementById('cqPromo');
    if (!box) return;
    if (!cq.pendingPromo) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
}

function cqChoosePromo(type) {
    const p = cq.pendingPromo;
    if (!p) return;
    cq.pendingPromo = null;
    cqRenderPromo();
    cqCommitLocalMove({ from: p.from, to: p.to, promo: type });
}

// ---------- 邀请 ----------
function cqCopyInvite() {
    if (!cq.room) return;
    if (location.protocol === 'file:') {
        alert('当前是本地文件方式打开（file://），无法生成可分享的邀请链接。请让对方用房间码加入：' + cq.room.code);
        return;
    }
    const url = `${location.origin}${location.pathname}?game=${encodeURIComponent(cq.game)}&code=${encodeURIComponent(cq.room.code)}`;
    const done = () => alert('邀请链接已复制：\n' + url);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => prompt('复制下面的邀请链接：', url));
    } else {
        prompt('复制下面的邀请链接：', url);
    }
}

async function cqInviteFromUrl() {
    const params = new URLSearchParams(location.search);
    const game = params.get('game');
    const code = params.get('code');
    if (!game || !code || !CQ_META[game]) return;
    if (!isAdmin) return;
    await cqJoinRoom(game, code);
}

// 初始化：绑定棋盘点击
window.addEventListener('load', function () {
    const canvas = document.getElementById('cqCanvas');
    if (canvas) canvas.addEventListener('click', cqCanvasClick);
    if (isAdmin) setTimeout(cqInviteFromUrl, 400);
});
