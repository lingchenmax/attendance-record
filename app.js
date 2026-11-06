// app.js
const SUPABASE_URL = 'https://qaffdlewwsfzgoruhjho.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_bLoMgVcw3cv7hO8bJyVplA_O_ESlK6j'; 

let dbClient = null;
let loveQuotes = ["今天辛苦啦！", "加油哦！"];

function initSupabase() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
            dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log("✅ Supabase 客户端初始化成功");
            checkSession();
        } catch (e) {
            console.error("❌ 创建 Supabase 客户端失败:", e);
        }
    } else {
        console.log("⏳ 等待 Supabase SDK 加载...");
        setTimeout(initSupabase, 200);
    }
}

window.onerror = function(msg, url, line, col, error) {
    console.error("系统发生错误:", msg, "行号:", line);
    return false;
};

const DATA_VERSION = 'v4';
if(localStorage.getItem('holiday_data_version') !== DATA_VERSION) {
    let customHolidays3x = ["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-04-05","2026-05-01","2026-06-19","2026-09-25","2026-10-01","2026-10-02","2026-10-03"];
    let customHolidays2x = ["2026-02-15","2026-02-19","2026-02-20","2026-02-21","2026-02-22","2026-02-23","2026-04-04","2026-04-06","2026-05-02","2026-05-03","2026-05-04","2026-05-05","2026-06-20","2026-06-21","2026-09-26","2026-09-27","2026-10-04","2026-10-05","2026-10-06","2026-10-07"];
    let customWorkdays = ["2026-01-04","2026-02-14","2026-02-28","2026-05-09","2026-09-20","2026-10-10"];
    
    localStorage.setItem('sys_holidays_3x', JSON.stringify(customHolidays3x));
    localStorage.setItem('sys_holidays_2x', JSON.stringify(customHolidays2x));
    localStorage.setItem('sys_workdays', JSON.stringify(customWorkdays));
    localStorage.setItem('holiday_data_version', DATA_VERSION);
}

let customHolidays3x = JSON.parse(localStorage.getItem('sys_holidays_3x') || '[]');
let customHolidays2x = JSON.parse(localStorage.getItem('sys_holidays_2x') || '[]');
let customWorkdays = JSON.parse(localStorage.getItem('sys_workdays') || '[]');

let currentUser = null;
let isAdmin = false;
let myEmpId = '';

let rosterData = [];
let gatesData = [];
let crossData = [];
let makeupData = [];
let leaveData = []; 
let specialOtData = []; 
let dutyData = []; 
let recordsData = []; 

let recordsIndex = {}; 

let currentShift = localStorage.getItem('sys_shift') || 'winter';
let workStartTime, workEndTime, lunchStart, lunchEnd;
let currentFilter = 'all';
let currentAttendanceResult = [];

// ========== 1. 登录与鉴权逻辑 ==========
async function checkSession() {
    if (!dbClient) return;
    try {
        const { data: { session }, error } = await dbClient.auth.getSession();
        if (session) {
            await initUser(session.user);
        }
    } catch(e) {
        console.error("获取Session失败:", e);
    }
}

async function handleLogin() {
    if (!dbClient) {
        document.getElementById('login-error').textContent = "系统正在加载核心组件，请稍后重试...";
        document.getElementById('login-error').style.display = 'block';
        return;
    }

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errDiv = document.getElementById('login-error');
    const btn = document.getElementById('loginBtn');
    
    errDiv.style.display = 'none';
    if(!email || !password) {
        errDiv.textContent = "请填写邮箱和密码";
        errDiv.style.display = 'block';
        return;
    }

    btn.textContent = '登录中...';
    btn.disabled = true;
    
    try {
        const { data, error } = await dbClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await initUser(data.user);
    } catch (error) {
        console.error("登录异常:", error);
        errDiv.textContent = "登录失败：" + (error.message || "网络异常");
        errDiv.style.display = 'block';
        btn.textContent = '登 录';
        btn.disabled = false;
    }
}

async function initUser(user) {
    currentUser = user;
    document.getElementById('loginBtn').textContent = '拉取数据中...';
    
    try {
        const { data: profile, error } = await dbClient.from('profiles').select('*').eq('id', user.id).single();
        if (error) {
            if(error.code === 'PGRST116') throw new Error("账号未配置权限信息，请联系管理员添加白名单。");
            throw error;
        }
        
        if (!profile || !profile.is_whitelisted) {
            await dbClient.auth.signOut();
            throw new Error("您不在系统白名单内，禁止访问。");
        }

        isAdmin = (profile.role === 'admin');
        myEmpId = profile.emp_id;

        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('main-container').style.display = 'block';
        document.getElementById('ui-email').textContent = user.email;
        document.getElementById('ui-role').textContent = isAdmin ? '管理员' : '普通员工';

        if (isAdmin) {
            document.querySelectorAll('.admin-only').forEach(el => {
                el.classList.remove('admin-only'); 
            });
            document.getElementById('heart-mover').style.display = 'block';
            initHeartFeature();
        }

        document.getElementById('shiftSelect').value = currentShift;
        updateShiftTimes();
        renderHolidayTable();

        await loadAllData();
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('queryDate').value = today;
        document.getElementById('otMonth').value = today.substring(0, 7);
        document.getElementById('normalMonth').value = today.substring(0, 7);
        document.getElementById('calcMonth').value = today.substring(0, 7);
        
        renderAttendanceTable();
        
    } catch (error) {
        console.error("初始化用户失败:", error);
        await dbClient.auth.signOut();
        const errDiv = document.getElementById('login-error');
        errDiv.textContent = error.message || "系统错误，无法进入";
        errDiv.style.display = 'block';
        document.getElementById('loginBtn').textContent = '登 录';
        document.getElementById('loginBtn').disabled = false;
    }
}

async function handleLogout() {
    await dbClient.auth.signOut();
    location.reload();
}

document.getElementById('loginPassword').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') handleLogin();
});

// ========== 2. 从 Supabase 加载数据 ==========
async function loadAllData() {
    if (!dbClient) return; 
    try {
        if (isAdmin) {
            const { data: quotesData } = await dbClient.from('love_quotes').select('content');
            if (quotesData && quotesData.length > 0) {
                loveQuotes = quotesData.map(q => q.content);
            }
        }

        let { data: gates } = await dbClient.from('gates').select('name');
        if(gates.length === 0 && isAdmin) {
            const defaultGates = ["办公楼1楼东南楼梯口考勤_门_1", "办公楼1楼东北楼梯口考勤_门_1", "办公楼1F电梯口考勤_门_1", "3厂预处理车间门口考勤机_门_1", "办公楼1楼前台考勤_门_1", "设备动力二层楼考勤机_门_1", "3厂分段车间东外墙考勤_门_1"];
            await dbClient.from('gates').insert(defaultGates.map(g => ({ name: g })));
            gates = defaultGates.map(g => ({name: g}));
        }
        gatesData = gates.map(g => g.name);

        const { data: roster } = await dbClient.from('roster').select('*').order('sort_order', { ascending: true });
        rosterData = roster.map(r => ({
            '序号': r.sort_order || 0, '科室': r.dept, '人员姓名': r.name, '工号': r.emp_id, '集团工号': r.group_id, '备注': r.remark, _id: r.id
        }));
        
        const datalist = document.getElementById('rosterNames');
        datalist.innerHTML = rosterData.map(r => `<option value="${r['人员姓名']}">${r['工号']}</option>`).join('');

        let allRecords = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        let recordsQuery = dbClient.from('records').select('*');
        if(!isAdmin) recordsQuery = recordsQuery.eq('emp_id', myEmpId);

        while(hasMore) {
            const { data: records } = await recordsQuery.range(page * pageSize, (page + 1) * pageSize - 1);
            if(records && records.length > 0) {
                allRecords = allRecords.concat(records);
                if (records.length < pageSize) hasMore = false;
                else page++;
            } else {
                hasMore = false;
            }
        }
        
        recordsIndex = {};
        recordsData = allRecords.map(r => {
            // 使用正则严格匹配日期和具体时间，无视毫秒和时区
            const match = String(r.time).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
            let dateStr = '';
            let timeOnly = '';
            
            if (match) {
                dateStr = match[1];
                timeOnly = match[2];
            } else {
                // 旧版本兜底逻辑
                const timeStr = r.time.replace('T', ' ').replace('.000Z', '');
                dateStr = timeStr.split(' ')[0];
                timeOnly = timeStr.split(' ')[1];
            }
            
            const keyId = `${r.emp_id}_${dateStr}`;
            const keyName = `${r.name}_${dateStr}`;
            
            if(!recordsIndex[keyId]) recordsIndex[keyId] = [];
            if(!recordsIndex[keyName]) recordsIndex[keyName] = [];
            
            recordsIndex[keyId].push(timeOnly);
            recordsIndex[keyName].push(timeOnly);

            return { name: r.name, id: r.emp_id, gate: r.gate, time: r.time };
        });
        
        if(document.getElementById('recordCount')) document.getElementById('recordCount').textContent = recordsData.length;

        let crossQuery = dbClient.from('cross_list').select('*');
        if(!isAdmin) crossQuery = crossQuery.eq('emp_id', myEmpId);
        const { data: cross } = await crossQuery;
        crossData = cross.map(c => ({ name: c.name, id: c.emp_id, date: c.date, remark: c.remark, _id: c.id }));

        let makeupQuery = dbClient.from('makeup_list').select('*');
        if(!isAdmin) makeupQuery = makeupQuery.eq('emp_id', myEmpId);
        const { data: makeup } = await makeupQuery;
        makeupData = makeup.map(m => ({ name: m.name, id: m.emp_id, date: m.date, start: m.start_time, end: m.end_time, _id: m.id }));

        let leaveQuery = dbClient.from('leave_list').select('*');
        if(!isAdmin) leaveQuery = leaveQuery.eq('emp_id', myEmpId);
        const { data: leave } = await leaveQuery;
        leaveData = leave.map(l => ({ name: l.name, id: l.emp_id, date: l.date, type: l.type, hours: l.hours, _id: l.id }));

        let specialOtQuery = dbClient.from('special_ot_list').select('*');
        if(!isAdmin) specialOtQuery = specialOtQuery.eq('emp_id', myEmpId);
        const { data: specialOt } = await specialOtQuery;
        specialOtData = (specialOt || []).map(s => ({ 
            name: s.name, id: s.emp_id, date: s.date, start: s.start_time, end: s.end_time, hours: s.hours, _id: s.id 
        }));

        let dutyQuery = dbClient.from('duty_list').select('*');
        if(!isAdmin) dutyQuery = dutyQuery.eq('emp_id', myEmpId);
        const { data: duty } = await dutyQuery;
        dutyData = (duty || []).map(d => ({ 
            name: d.name, id: d.emp_id, date: d.date, remark: d.remark, _id: d.id 
        }));

        renderRosterTable();
        renderGateTable();
        renderExtraTables();
        
    } catch (e) {
        console.error("拉取业务数据失败:", e);
        alert("数据加载失败，请检查网络或 F12 查看报错。");
    }
}

// ========== 3. 基础工具函数 ==========
function cleanStr(str) { return String(str || "").replace(/[\s\u3000]/g, '').trim(); }
function readExcel(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array', cellDates: true});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""});
        callback(json.map(row => {
            let newRow = {};
            for(let key in row) newRow[key.trim()] = row[key];
            return newRow;
        }));
    };
    reader.readAsArrayBuffer(file);
}

function getDateStr(rawDate) {
    if(!rawDate) return null;
    if(rawDate instanceof Date) {
        return `${rawDate.getFullYear()}-${(rawDate.getMonth()+1).toString().padStart(2,'0')}-${rawDate.getDate().toString().padStart(2,'0')}`;
    }
    const str = String(rawDate).trim();
    const dMatch = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(dMatch) return `${dMatch[1]}-${dMatch[2].padStart(2,'0')}-${dMatch[3].padStart(2,'0')}`;
    return null;
}

function parseTimeString(val) {
    if (!val) return null;
    if (val instanceof Date) {
        const y = val.getFullYear(); const m = (val.getMonth()+1).toString().padStart(2,'0'); const d = val.getDate().toString().padStart(2,'0');
        const h = val.getHours().toString().padStart(2,'0'); const min = val.getMinutes().toString().padStart(2,'0'); const s = val.getSeconds().toString().padStart(2,'0');
        return `${y}-${m}-${d}T${h}:${min}:${s}.000Z`; 
    }
    const str = String(val).trim();
    const dMatch = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const tMatch = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (dMatch && tMatch) {
        const date = `${dMatch[1]}-${dMatch[2].padStart(2,'0')}-${dMatch[3].padStart(2,'0')}`;
        const time = `${tMatch[1].padStart(2,'0')}:${tMatch[2].padStart(2,'0')}:${tMatch[3]?tMatch[3].padStart(2,'0'):"00"}`;
        return `${date}T${time}.000Z`;
    }
    return null;
}

function isWorkday(dateStr) {
    if (customHolidays3x.includes(dateStr) || customHolidays2x.includes(dateStr)) return false;
    if (customWorkdays.includes(dateStr)) return true;
    const d = new Date(dateStr);
    return d.getDay() !== 0 && d.getDay() !== 6;
}

function getOvertimeType(dateStr) {
    if (customHolidays3x.includes(dateStr)) return 3;
    if (customHolidays2x.includes(dateStr)) return 2;
    const d = new Date(dateStr);
    if (d.getDay() === 0 || d.getDay() === 6) return 2;
    return 1;
}

function timeToMinutes(tStr) {
    if(!tStr) return 0;
    const match = String(tStr).match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (match) {
        const h = Number(match[1]) || 0;
        const m = Number(match[2]) || 0;
        const s = Number(match[3]) || 0;
        return h * 60 + m + (s / 60);
    }
    return 0;
}

function updateShiftTimes() {
    if (currentShift === 'winter') { workStartTime = "08:00:00"; workEndTime = "17:00:00"; lunchStart = "12:00:00"; lunchEnd = "13:00:00"; }
    else if (currentShift === 'summer') { workStartTime = "08:00:00"; workEndTime = "18:00:00"; lunchStart = "12:00:00"; lunchEnd = "14:00:00"; }
    else { workStartTime = "08:00:00"; workEndTime = "17:30:00"; lunchStart = "12:00:00"; lunchEnd = "13:30:00"; }
}
updateShiftTimes();

function changeShift() {
    currentShift = document.getElementById('shiftSelect').value;
    localStorage.setItem('sys_shift', currentShift); 
    updateShiftTimes();
    alert('考勤时间制度已更新，并已为您永久保存。');
}

// ========== 节假日配置管理 ==========
function renderHolidayTable() {
    const tbody = document.getElementById('holidayTableBody');
    if (!tbody) return;
    
    let allHolidays = [];
    customHolidays3x.forEach(d => allHolidays.push({ date: d, type: 'holiday3' }));
    customHolidays2x.forEach(d => allHolidays.push({ date: d, type: 'holiday2' }));
    customWorkdays.forEach(d => allHolidays.push({ date: d, type: 'workday' }));
    
    allHolidays.sort((a, b) => a.date.localeCompare(b.date));

    tbody.innerHTML = allHolidays.map((h) => {
        let typeText = h.type === 'holiday3' ? '法定节假日(3倍)' : (h.type === 'holiday2' ? '普通休息日(2倍)' : '调休上班日');
        let color = h.type === 'workday' ? '#27ae60' : (h.type === 'holiday3' ? '#e74c3c' : '#d35400');
        return `
        <tr>
            <td>${h.date}</td>
            <td style="color: ${color}; font-weight: bold;">${typeText}</td>
            <td><button class="danger" onclick="deleteHoliday('${h.date}', '${h.type}')" style="padding:2px 8px; font-size:12px;">删除</button></td>
        </tr>
    `}).join('');
}

function addHolidayConfig() {
    const date = document.getElementById('newHolidayDate').value;
    const type = document.getElementById('newHolidayType').value;
    if (!date) return alert('请选择日期');

    customHolidays3x = customHolidays3x.filter(d => d !== date);
    customHolidays2x = customHolidays2x.filter(d => d !== date);
    customWorkdays = customWorkdays.filter(d => d !== date);

    if (type === 'holiday3') customHolidays3x.push(date);
    else if (type === 'holiday2') customHolidays2x.push(date);
    else if (type === 'workday') customWorkdays.push(date);

    saveHolidayToLocal();
    renderHolidayTable();
    document.getElementById('newHolidayDate').value = '';
}

function deleteHoliday(date, type) {
    if (type === 'holiday3') customHolidays3x = customHolidays3x.filter(d => d !== date);
    else if (type === 'holiday2') customHolidays2x = customHolidays2x.filter(d => d !== date);
    else customWorkdays = customWorkdays.filter(d => d !== date);
    saveHolidayToLocal();
    renderHolidayTable();
}

function saveHolidayToLocal() {
    localStorage.setItem('sys_holidays_3x', JSON.stringify(customHolidays3x));
    localStorage.setItem('sys_holidays_2x', JSON.stringify(customHolidays2x));
    localStorage.setItem('sys_workdays', JSON.stringify(customWorkdays));
}

function uploadHolidays(e) {
    const file = e.target.files[0];
    if(!file) return;
    readExcel(file, (data) => {
        let added = 0;
        data.forEach(row => {
            const rawDate = row['日期'] || row['date'];
            const rawType = row['类型'] || row['type'];
            if(!rawDate || !rawType) return;

            let dateStr = getDateStr(rawDate);
            if(!dateStr) return;
            const typeStr = String(rawType).trim();
            
            customHolidays3x = customHolidays3x.filter(d => d !== dateStr);
            customHolidays2x = customHolidays2x.filter(d => d !== dateStr);
            customWorkdays = customWorkdays.filter(d => d !== dateStr);
            
            if (typeStr.includes('3') || typeStr.includes('法定')) {
                customHolidays3x.push(dateStr);
            } else if (typeStr.includes('2') || typeStr.includes('普通') || typeStr.includes('休')) {
                customHolidays2x.push(dateStr);
            } else if (typeStr.includes('班') || typeStr.toLowerCase().includes('work')) {
                customWorkdays.push(dateStr);
            }
            added++;
        });

        saveHolidayToLocal();
        renderHolidayTable();
        alert(`成功处理 ${added} 条节假日数据！`);
        e.target.value = ''; 
    });
}

function exportHolidays() {
    let allHolidays = [];
    customHolidays3x.forEach(d => allHolidays.push({ '日期': d, '类型': '法定节假日(3倍)' }));
    customHolidays2x.forEach(d => allHolidays.push({ '日期': d, '类型': '普通休息日(2倍)' }));
    customWorkdays.forEach(d => allHolidays.push({ '日期': d, '类型': '调休上班日(班)' }));
    allHolidays.sort((a, b) => a['日期'].localeCompare(b['日期']));
    
    const csv = Papa.unparse(allHolidays);
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `节假日配置导出.csv`; link.click();
}

// ========== 界面切换 ==========
function switchTab(tabId, btnElement) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tabs > .tab-btn').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById(tabId);
    if(target) target.classList.add('active');
    if(btnElement) btnElement.classList.add('active');
    
    if (tabId === 'tab-attendance') renderAttendanceTable();
}
function switchSubTab(tabId, btnElement) {
    document.querySelectorAll('#tab-extra .tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('#tab-extra .tabs > .tab-btn').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById(tabId);
    if(target) target.classList.add('active');
    if(btnElement) btnElement.classList.add('active');
}

// ========== 自动带出工号功能 ==========
function autoFillId(nameInputId, idInputId) {
    const name = document.getElementById(nameInputId).value.trim();
    if(!name) return;
    const match = rosterData.find(r => r['人员姓名'] === name);
    if (match) {
        document.getElementById(idInputId).value = match['工号'];
    }
}

document.getElementById('calcName').addEventListener('input', function() {
    autoFillId('calcName', 'calcEmpId');
});

// ========== 导出长图功能 ==========
function exportDetailImage(type) {
    const containerId = type === 'ot' ? 'otResultContainer' : 'normalResultContainer';
    const container = document.getElementById(containerId);
    
    if (!container || container.innerHTML.includes('empty-text') || container.innerHTML === '') {
        return alert('没有可导出的数据，请先刷新计算！');
    }

    const originalStyle = container.getAttribute('style') || '';

    container.style.overflow = 'visible';
    container.style.maxHeight = 'none';
    container.style.height = 'auto';
    container.style.width = 'max-content';

    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '⏳ 生成中...';
    btn.disabled = true;

    html2canvas(container, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: container.scrollWidth,
        windowHeight: container.scrollHeight
    }).then(canvas => {
        container.setAttribute('style', originalStyle);
        btn.textContent = originalText;
        btn.disabled = false;

        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${type === 'ot' ? '加班统计图' : '出勤统计图'}_${new Date().toISOString().split('T')[0]}.png`;
        link.href = imgData;
        link.click();
    }).catch(err => {
        console.error('生成图片失败:', err);
        alert('生成图片失败，请检查浏览器控制台。');
        container.setAttribute('style', originalStyle);
        btn.textContent = originalText;
        btn.disabled = false;
    });
}

// ========== 6. 批量导入综合报表 ==========
function uploadMultiSheetReport(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, {type: 'array', cellDates: true});
        
        let leaveAdded = 0, makeupAdded = 0, tripAdded = 0, specialOtAdded = 0;
        let toInsertLeaves = [];
        let toInsertMakeups = [];
        let toInsertTrips = [];
        let toInsertSpecialOts = [];

        function processSheet(sheetName, callback) {
            if(!workbook.Sheets[sheetName]) return;
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1, defval: ""});
            if(rows.length < 2) return;
            
            let headerIdx = 0;
            for(let i=0; i<Math.min(5, rows.length); i++) {
                let rowStr = rows[i].join(',');
                if(rowStr.includes('姓名') || rowStr.includes('人员') || rowStr.includes('工号')) {
                    headerIdx = i;
                    break;
                }
            }
            
            const headers = rows[headerIdx].map(h => String(h).trim());
            const dataRows = rows.slice(headerIdx + 1);
            
            const idIdx = headers.findIndex(h => h.includes('工号') && !h.includes('集团'));
            let nameIdx = headers.findIndex(h => h.includes('姓名') || h.includes('人员'));
            
            callback(dataRows, headers, nameIdx, idIdx);
        }

        // 1. 休假汇总表
        processSheet('休假汇总表', (rows, headers, nameIdx, idIdx) => {
            const startIdx = headers.findIndex(h => h.includes('开始日期'));
            const endIdx = headers.findIndex(h => h.includes('结束日期'));
            const typeIdx = headers.findIndex(h => h.includes('类型'));
            
            if(nameIdx === -1 || startIdx === -1 || idIdx === -1) return;

            function parseDateMins(val) {
                if(!val) return null;
                let dateStr = getDateStr(val);
                let mins = null;
                if (val instanceof Date) {
                    mins = Math.round(val.getHours() * 60 + val.getMinutes() + val.getSeconds() / 60);
                } else {
                    const tMatch = String(val).match(/(\d{1,2}):(\d{1,2})/);
                    if (tMatch) mins = parseInt(tMatch[1]) * 60 + parseInt(tMatch[2]);
                }
                return { date: dateStr, mins: mins };
            }

            rows.forEach(row => {
                const name = cleanStr(row[nameIdx]);
                const empId = cleanStr(row[idIdx]);
                const sInfo = parseDateMins(row[startIdx]);
                const eInfo = parseDateMins(row[endIdx] || row[startIdx]);
                let typeStr = String(row[typeIdx] || '事假').trim();
                
                if(name && sInfo && sInfo.date && eInfo && eInfo.date && typeStr !== '出差') {
                    let cur = new Date(sInfo.date);
                    let end = new Date(eInfo.date);
                    
                    const wStart = timeToMinutes(workStartTime);
                    const wEnd = timeToMinutes(workEndTime);
                    const lStart = timeToMinutes(lunchStart);
                    const lEnd = timeToMinutes(lunchEnd);

                    while(cur <= end) {
                        const dStr = cur.toISOString().split('T')[0];
                        if(isWorkday(dStr)) {
                            let s = wStart;
                            let e = wEnd;
                            
                            if (dStr === sInfo.date && sInfo.mins !== null) s = Math.max(wStart, sInfo.mins);
                            if (dStr === eInfo.date && eInfo.mins !== null) e = Math.min(wEnd, eInfo.mins);
                            
                            if (e > s) {
                                let dur1 = Math.max(0, Math.min(e, lStart) - Math.max(s, wStart));
                                let dur2 = Math.max(0, Math.min(e, wEnd) - Math.max(s, lEnd));
                                let hrs = (dur1 + dur2) / 60;
                                hrs = Math.round(hrs * 2) / 2;
                                
                                if (hrs > 0) {
                                    toInsertLeaves.push({ name, emp_id: empId, date: dStr, type: typeStr, hours: hrs });
                                }
                            }
                        }
                        cur.setDate(cur.getDate() + 1);
                    }
                }
            });
        });

        // 2. 出差汇总表
        processSheet('出差汇总表', (rows, headers, nameIdx, idIdx) => {
            const startIdx = headers.findIndex(h => h.includes('开始日期'));
            const endIdx = headers.findIndex(h => h.includes('结束日期'));

            if(nameIdx === -1 || startIdx === -1 || idIdx === -1) return;

            rows.forEach(row => {
                const name = cleanStr(row[nameIdx]);
                const empId = cleanStr(row[idIdx]);
                const startD = getDateStr(row[startIdx]);
                const endD = getDateStr(row[endIdx] || row[startIdx]);

                if(name && startD && endD) {
                    let cur = new Date(startD);
                    let end = new Date(endD);
                    while(cur <= end) {
                        const dStr = cur.toISOString().split('T')[0];
                        if(isWorkday(dStr)) {
                            toInsertTrips.push({ name, emp_id: empId, date: dStr, type: '出差', hours: 8 });
                        }
                        cur.setDate(cur.getDate() + 1);
                    }
                }
            });
        });

        // 3. 异常补卡
        processSheet('异常补卡', (rows, headers, nameIdx, idIdx) => {
            const timeIdx = headers.findIndex(h => h.includes('时间'));
            const typeIdx = headers.findIndex(h => h.includes('类型'));

            if(nameIdx === -1 || timeIdx === -1 || idIdx === -1) return;

            rows.forEach(row => {
                const name = cleanStr(row[nameIdx]);
                const empId = cleanStr(row[idIdx]);
                const dStr = getDateStr(row[timeIdx]);
                const tStr = row[timeIdx];
                const typeStr = String(row[typeIdx] || '').trim();

                if(name && dStr) {
                    let timeOnly = null;
                    if (tStr instanceof Date) {
                        let totalMins = Math.round(tStr.getHours() * 60 + tStr.getMinutes() + tStr.getSeconds() / 60);
                        if(totalMins === 1440) totalMins = 0; 
                        timeOnly = `${Math.floor(totalMins/60).toString().padStart(2,'0')}:${(totalMins%60).toString().padStart(2,'0')}`;
                    } else {
                        const tMatch = String(tStr).match(/(\d{1,2}):(\d{1,2})/);
                        if (tMatch) timeOnly = `${tMatch[1].padStart(2,'0')}:${tMatch[2].padStart(2,'0')}`;
                    }
                    
                    if (!timeOnly) return;

                    if (typeStr.includes('上班') || typeStr.includes('中午上班')) {
                        toInsertMakeups.push({ name, emp_id: empId, date: dStr, start_time: timeOnly, end_time: null });
                    } else if (typeStr.includes('下班') || typeStr.includes('中午下班')) {
                        toInsertMakeups.push({ name, emp_id: empId, date: dStr, start_time: null, end_time: timeOnly });
                    }
                }
            });
        });

        // 4. 特殊加班申请
        processSheet('特殊加班申请', (rows, headers, nameIdx, idIdx) => {
            const dateIdx = headers.findIndex(h => h.includes('日期'));
            const startIdx = headers.findIndex(h => h.includes('开始时间'));
            const endIdx = headers.findIndex(h => h.includes('结束时间'));
            const hourIdx = headers.findIndex(h => h.includes('合计'));

            if(nameIdx === -1 || dateIdx === -1 || hourIdx === -1) return;

            rows.forEach(row => {
                const name = cleanStr(row[nameIdx]);
                const empId = cleanStr(row[idIdx]);
                const dStr = getDateStr(row[dateIdx]);
                const rawHours = row[hourIdx];
                
                if(name && dStr && rawHours !== undefined && rawHours !== '') {
                    const hours = parseFloat(rawHours);
                    if(!isNaN(hours)) {
                        let startTime = null, endTime = null;
                        const parseT = (val) => {
                            if(!val) return null;
                            if(val instanceof Date) {
                                return `${val.getHours().toString().padStart(2,'0')}:${val.getMinutes().toString().padStart(2,'0')}`;
                            }
                            const tMatch = String(val).match(/(\d{1,2}):(\d{1,2})/);
                            return tMatch ? `${tMatch[1].padStart(2,'0')}:${tMatch[2].padStart(2,'0')}` : null;
                        };
                        if(startIdx !== -1) startTime = parseT(row[startIdx]);
                        if(endIdx !== -1) endTime = parseT(row[endIdx]);

                        toInsertSpecialOts.push({ name, emp_id: empId, date: dStr, start_time: startTime, end_time: endTime, hours: hours });
                    }
                }
            });
        });

        // =========================================================
        // 【覆盖式+增补式添加逻辑】
        // =========================================================

        // 1. 休假
        if (toInsertLeaves.length > 0) {
            let keysToDelete = toInsertLeaves.map(l => `${l.name}_${l.emp_id}_${l.date}_${l.type}`);
            let idsToDel = leaveData.filter(l => l.type !== '出差' && keysToDelete.includes(`${l.name}_${l.id}_${l.date}_${l.type}`)).map(l => l._id);
            if (idsToDel.length > 0) await dbClient.from('leave_list').delete().in('id', idsToDel);
            await dbClient.from('leave_list').insert(toInsertLeaves);
            leaveAdded = toInsertLeaves.length;
        }

        // 2. 出差
        if (toInsertTrips.length > 0) {
            let keysToDelete = toInsertTrips.map(l => `${l.name}_${l.emp_id}_${l.date}_出差`);
            let idsToDel = leaveData.filter(l => l.type === '出差' && keysToDelete.includes(`${l.name}_${l.id}_${l.date}_出差`)).map(l => l._id);
            if (idsToDel.length > 0) await dbClient.from('leave_list').delete().in('id', idsToDel);
            await dbClient.from('leave_list').insert(toInsertTrips);
            tripAdded = toInsertTrips.length;
        }

        // 3. 补卡
        if (toInsertMakeups.length > 0) {
            let keysToDelete = toInsertMakeups.map(l => `${l.name}_${l.emp_id}_${l.date}`);
            let idsToDel = makeupData.filter(m => keysToDelete.includes(`${m.name}_${m.id}_${m.date}`)).map(m => m._id);
            if (idsToDel.length > 0) await dbClient.from('makeup_list').delete().in('id', idsToDel);
            await dbClient.from('makeup_list').insert(toInsertMakeups);
            makeupAdded = toInsertMakeups.length;
        }

        // 4. 特殊加班
        if (toInsertSpecialOts.length > 0) {
            let keysToDelete = toInsertSpecialOts.map(l => `${l.name}_${l.emp_id}_${l.date}_${l.hours}`);
            let idsToDel = specialOtData.filter(l => keysToDelete.includes(`${l.name}_${l.id}_${l.date}_${l.hours}`)).map(l => l._id);
            if (idsToDel.length > 0) await dbClient.from('special_ot_list').delete().in('id', idsToDel);
            await dbClient.from('special_ot_list').insert(toInsertSpecialOts);
            specialOtAdded = toInsertSpecialOts.length;
        }

        alert(`批量导入完成！\n休假拆分添加: ${leaveAdded} 条\n出差拆分添加: ${tripAdded} 条\n补卡添加: ${makeupAdded} 条\n特殊加班添加: ${specialOtAdded} 条\n\n注：重复数据已自动覆盖。`);
        await loadAllData();
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}


// ========== 4. 管理端操作 ==========
document.getElementById('recordUpload').addEventListener('change', async e => {
    if (!e.target.files[0]) return;
    const file = e.target.files[0];
    readExcel(file, async data => {
        let toUploadMap = new Map();

        data.forEach(row => {
            const name = cleanStr(row['人员姓名']);
            const id = cleanStr(row['工号']);
            const gate = cleanStr(row['门禁点']);
            const rawTime = row['事件时间'];
            const isValidGate = gatesData.some(vg => gate.includes(vg));
            
            if (name && id && isValidGate && rawTime) {
                const time = parseTimeString(rawTime);
                if (time) {
                    const uniqueKey = `${name}_${id}_${time}_${gate}`;
                    toUploadMap.set(uniqueKey, { name, emp_id: id, gate, time });
                }
            }
        });

        const toUpload = Array.from(toUploadMap.values());
        if(toUpload.length === 0) return alert("未发现有效数据或全部为重复数据");

        const CHUNK_SIZE = 800; 
        let successCount = 0;

        for (let i = 0; i < toUpload.length; i += CHUNK_SIZE) {
            const chunk = toUpload.slice(i, i + CHUNK_SIZE);
            const { error } = await dbClient.from('records').upsert(chunk, { onConflict: 'name, emp_id, gate, time' });
            if (error) {
                alert(`上传在第 ${i + 1} 条至 ${i + chunk.length} 条时失败：${error.message}`);
                break; 
            }
            successCount += chunk.length;
        }
        alert(`操作完成！成功上传 ${successCount} 条数据。`);
        await loadAllData();
        renderAttendanceTable();
    });
});

async function clearAllRecords() {
    if(!confirm('警告：确定清空云端所有打卡记录？')) return;
    const { error } = await dbClient.from('records').delete().neq('id', 0); 
    if(!error) { 
        recordsData = [];
        recordsIndex = {};
        document.getElementById('recordCount').textContent = '0';
        alert('已清空'); 
    }
}

function exportRecordsPool() {
    if(recordsData.length === 0) return alert('没有可导出的数据');
    const exportData = recordsData.map(r => ({
        '人员姓名': r.name,
        '工号': r.id,
        '门禁点': r.gate,
        '事件时间': r.time.replace('T', ' ').replace('.000Z', '')
    }));
    const csv = Papa.unparse(exportData);
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `打卡数据池备份_${new Date().toISOString().split('T')[0]}.csv`; link.click();
}

function renderRosterTable() {
    if(!isAdmin) return; 
    const tbody = document.querySelector('#rosterTable tbody');
    if (!tbody) return;
    const keyword = document.getElementById('searchRoster').value.toLowerCase().trim();
    let htmlData = '';
    
    rosterData.forEach((p, idx) => {
        const dept = String(p['科室'] || '').toLowerCase(); const name = String(p['人员姓名'] || '').toLowerCase();
        const empId = String(p['工号'] || '').toLowerCase(); const groupId = String(p['集团工号'] || '').toLowerCase();

        if (keyword && !dept.includes(keyword) && !name.includes(keyword) && !empId.includes(keyword) && !groupId.includes(keyword)) return;

        if (p._isEditing) {
            htmlData += `<tr>
                <td><input type="number" id="edit-sort-${idx}" value="${p['序号']||''}" style="width:60px;"></td>
                <td><input type="text" id="edit-dept-${idx}" value="${p['科室']||''}"></td>
                <td><input type="text" id="edit-name-${idx}" value="${p['人员姓名']||''}"></td>
                <td><input type="text" id="edit-empid-${idx}" value="${p['工号']||''}"></td>
                <td><input type="text" id="edit-groupid-${idx}" value="${p['集团工号']||''}"></td>
                <td><input type="text" id="edit-remark-${idx}" value="${p['备注']||''}"></td>
                <td><button class="success" onclick="saveRosterEdit(${idx})" style="padding:4px 8px;">保存</button><button class="danger" onclick="cancelRosterEdit(${idx})" style="padding:4px 8px;">取消</button></td>
            </tr>`;
        } else {
            htmlData += `<tr>
                <td>${p['序号']||''}</td>
                <td>${p['科室']||''}</td><td>${p['人员姓名']||''}</td><td>${p['工号']||''}</td><td>${p['集团工号']||''}</td><td>${p['备注']||''}</td>
                <td><button onclick="editRoster(${idx})" style="padding:4px 8px; background:#f39c12;">修改</button><button class="danger" onclick="deleteRoster(${idx}, ${p._id})" style="padding:4px 8px;">删除</button></td>
            </tr>`;
        }
    });
    tbody.innerHTML = htmlData;
}

function exportRosterData() {
    if(rosterData.length === 0) return alert('没有人员数据');
    const exportData = rosterData.map(r => ({
        '科室': r['科室'],
        '人员姓名': r['人员姓名'],
        '工号': r['工号'],
        '集团工号': r['集团工号'],
        '备注': r['备注']
    }));
    const csv = Papa.unparse(exportData);
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `人员名单备份_${new Date().toISOString().split('T')[0]}.csv`; link.click();
}

function editRoster(idx) { rosterData[idx]._isEditing = true; renderRosterTable(); }
function cancelRosterEdit(idx) { delete rosterData[idx]._isEditing; renderRosterTable(); }

async function saveRosterEdit(idx) {
    const p = rosterData[idx];
    const newSortStr = document.getElementById(`edit-sort-${idx}`).value;
    const newSort = newSortStr ? parseInt(newSortStr) : 0;

    if (newSort > 0 && newSort !== p['序号']) {
        const { data: conflictList } = await dbClient.from('roster').select('id, sort_order').gte('sort_order', newSort);
        if (conflictList && conflictList.length > 0) {
            for (let item of conflictList) {
                await dbClient.from('roster').update({ sort_order: item.sort_order + 1 }).eq('id', item.id);
            }
        }
    }

    const updated = {
        sort_order: newSort,
        dept: document.getElementById(`edit-dept-${idx}`).value,
        name: document.getElementById(`edit-name-${idx}`).value,
        emp_id: document.getElementById(`edit-empid-${idx}`).value,
        group_id: document.getElementById(`edit-groupid-${idx}`).value,
        remark: document.getElementById(`edit-remark-${idx}`).value
    };
    
    if(p._id) await dbClient.from('roster').update(updated).eq('id', p._id);
    else {
        const { data } = await dbClient.from('roster').insert(updated).select();
        if(data && data.length > 0) p._id = data[0].id;
    }
    await loadAllData();
}

async function deleteRoster(idx, dbId) {
    if(!confirm('确认删除该人员？')) return;
    const backup = rosterData[idx];
    rosterData.splice(idx, 1);
    renderRosterTable();
    
    const { error } = await dbClient.from('roster').delete().eq('id', dbId);
    if(error) {
        alert('删除失败，已恢复');
        rosterData.splice(idx, 0, backup);
        renderRosterTable();
    }
}

function openAddRoster() { rosterData.unshift({ '科室': '', '人员姓名': '', '工号': '', '集团工号': '', '备注': '', _isEditing: true }); renderRosterTable(); }

function uploadRoster(e) {
    const file = e.target.files[0];
    if(!file) return;
    readExcel(file, async (data) => {
        const toUpload = data.map((row, index) => ({ 
            sort_order: row['序号'] ? parseInt(row['序号']) : index + 1,
            dept: row['科室'] || '', name: row['人员姓名'] || '', emp_id: row['工号'] || '', group_id: row['集团工号'] || '', remark: row['备注'] || '' 
        }));
        const { error } = await dbClient.from('roster').delete().neq('id', 0);
        if(!error) {
            const { error: insErr } = await dbClient.from('roster').insert(toUpload);
            if(insErr) alert("导入失败：" + insErr.message);
            else { alert('导入成功！'); await loadAllData(); }
        }
    });
}

function renderGateTable() {
    if(!isAdmin) return;
    const tbody = document.querySelector('#gateTable tbody'); 
    if (!tbody) return;
    tbody.innerHTML = '';
    gatesData.forEach((g, idx) => { tbody.innerHTML += `<tr><td>${g}</td><td><button class="danger" onclick="deleteGate('${g}', ${idx})" style="padding:4px 8px;">删除</button></td></tr>`; });
}

async function addGate() {
    const val = document.getElementById('newGateName').value.trim();
    if(val) { 
        gatesData.push(val);
        renderGateTable();
        document.getElementById('newGateName').value = ''; 
        await dbClient.from('gates').insert({name: val}); 
    }
}

async function deleteGate(name, idx) {
    if(confirm('确认删除门禁点？')) { 
        gatesData.splice(idx, 1);
        renderGateTable();
        await dbClient.from('gates').delete().eq('name', name); 
    }
}

function renderExtraTables() {
    if(!isAdmin) return;
    
    if(document.querySelector('#crossTable tbody')) {
        const kwCross = document.getElementById('crossSearchName').value.trim();
        const monthCross = document.getElementById('crossMonthFilter').value;
        document.querySelector('#crossTable tbody').innerHTML = crossData
            .filter(c => (!kwCross || c.name.includes(kwCross)) && (!monthCross || String(c.date).startsWith(monthCross)))
            .map((c) => {
                const realIdx = crossData.findIndex(x => x._id === c._id);
                return `<tr><td>${c.name}</td><td>${c.id}</td><td>${c.date}</td><td>${c.remark}</td><td><button class="danger" onclick="delExtra('cross','${c._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#makeupTable tbody')) {
        const kwMakeup = document.getElementById('makeupSearchName').value.trim();
        const monthMakeup = document.getElementById('makeupMonthFilter').value;
        document.querySelector('#makeupTable tbody').innerHTML = makeupData
            .filter(m => (!kwMakeup || m.name.includes(kwMakeup)) && (!monthMakeup || String(m.date).startsWith(monthMakeup)))
            .map((m) => {
                const realIdx = makeupData.findIndex(x => x._id === m._id);
                return `<tr><td>${m.name}</td><td>${m.id}</td><td>${m.date}</td><td>${m.start}</td><td>${m.end}</td><td><button class="danger" onclick="delExtra('makeup','${m._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }
    
    const leaveList = leaveData.filter(l => l.type !== '出差');
    const tripList = leaveData.filter(l => l.type === '出差');
    
    if(document.querySelector('#leaveTable tbody')) {
        const filterName = document.getElementById('leaveSearchName').value.trim();
        const filterType = document.getElementById('leaveSearchType').value.trim();
        const monthLeave = document.getElementById('leaveMonthFilter').value;
        
        document.querySelector('#leaveTable tbody').innerHTML = leaveList
            .filter(l => (!filterName || l.name.includes(filterName)) && 
                         (!filterType || l.type.includes(filterType)) &&
                         (!monthLeave || String(l.date).startsWith(monthLeave)))
            .map((l) => {
                const realIdx = leaveData.findIndex(x => x._id === l._id);
                return `<tr><td>${l.name}</td><td>${l.id}</td><td>${l.date}</td><td>${l.type}</td><td>${l.hours}</td><td><button class="danger" onclick="delExtra('leave','${l._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#tripTable tbody')) {
        const kwTrip = document.getElementById('tripSearchName').value.trim();
        const monthTrip = document.getElementById('tripMonthFilter').value;
        document.querySelector('#tripTable tbody').innerHTML = tripList
            .filter(t => (!kwTrip || t.name.includes(kwTrip)) && (!monthTrip || String(t.date).startsWith(monthTrip)))
            .map((t) => {
                const realIdx = leaveData.findIndex(x => x._id === t._id);
                return `<tr><td>${t.name}</td><td>${t.id}</td><td>${t.date}</td><td>出差</td><td><button class="danger" onclick="delExtra('leave','${t._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#specialOtTable tbody')) {
        const kwSpecialOt = document.getElementById('specialOtSearchName').value.trim();
        const monthSpecialOt = document.getElementById('specialOtMonthFilter').value;
        document.querySelector('#specialOtTable tbody').innerHTML = specialOtData
            .filter(s => (!kwSpecialOt || s.name.includes(kwSpecialOt)) && (!monthSpecialOt || String(s.date).startsWith(monthSpecialOt)))
            .map((s) => {
                const realIdx = specialOtData.findIndex(x => x._id === s._id);
                return `<tr><td>${s.name}</td><td>${s.id}</td><td>${s.date}</td><td>${s.start||''}</td><td>${s.end||''}</td><td>${s.hours}</td><td><button class="danger" onclick="delExtra('special_ot','${s._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#dutyTable tbody')) {
        const kwDuty = document.getElementById('dutySearchName').value.trim();
        const monthDuty = document.getElementById('dutyMonthFilter').value;
        document.querySelector('#dutyTable tbody').innerHTML = dutyData
            .filter(s => (!kwDuty || s.name.includes(kwDuty)) && (!monthDuty || String(s.date).startsWith(monthDuty)))
            .map((s) => {
                const realIdx = dutyData.findIndex(x => x._id === s._id);
                return `<tr><td>${s.name}</td><td>${s.id}</td><td>${s.date}</td><td>${s.remark||''}</td><td><button class="danger" onclick="delExtra('duty','${s._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }
}

async function addExtra(type) {
    let payload = {}, table = '', localArray = null;
    if(type === 'duty') { 
        table = 'duty_list'; localArray = dutyData; 
        payload = { 
            name: document.getElementById('dutyName').value, 
            emp_id: document.getElementById('dutyId').value, 
            date: document.getElementById('dutyDate').value, 
            remark: document.getElementById('dutyRemark').value 
        }; 
    } else if(type === 'cross') { 
        table = 'cross_list'; localArray = crossData; 
        payload = { name: document.getElementById('crossName').value, emp_id: document.getElementById('crossId').value, date: document.getElementById('crossDate').value, remark: document.getElementById('crossRemark').value }; 
    } else if(type === 'makeup') { 
        table = 'makeup_list'; localArray = makeupData; 
        payload = { name: document.getElementById('makeupName').value, emp_id: document.getElementById('makeupId').value, date: document.getElementById('makeupDate').value, start_time: document.getElementById('makeupStart').value, end_time: document.getElementById('makeupEnd').value }; 
    } else if(type === 'trip') {
        table = 'leave_list'; localArray = leaveData;
        payload = { name: document.getElementById('tripName').value, emp_id: document.getElementById('tripId').value, date: document.getElementById('tripDate').value, type: '出差', hours: 8 };
    } else if(type === 'special_ot') { 
        table = 'special_ot_list'; localArray = specialOtData; 
        payload = { 
            name: document.getElementById('specialOtName').value, 
            emp_id: document.getElementById('specialOtId').value, 
            date: document.getElementById('specialOtDate').value, 
            start_time: document.getElementById('specialOtStart').value || null, 
            end_time: document.getElementById('specialOtEnd').value || null, 
            hours: parseFloat(document.getElementById('specialOtHours').value) || 0
        }; 
    } else { 
        table = 'leave_list'; localArray = leaveData; 
        let lType = document.getElementById('leaveType').value.trim() || '事假';
        payload = { name: document.getElementById('leaveName').value, emp_id: document.getElementById('leaveId').value, date: document.getElementById('leaveDate').value, type: lType, hours: document.getElementById('leaveHours').value }; 
    }
    
    const tempId = 'temp_' + Date.now();
    if(type === 'duty') localArray.push({ name: payload.name, id: payload.emp_id, date: payload.date, remark: payload.remark, _id: tempId });
    else if(type === 'cross') localArray.push({ name: payload.name, id: payload.emp_id, date: payload.date, remark: payload.remark, _id: tempId });
    else if(type === 'makeup') localArray.push({ name: payload.name, id: payload.emp_id, date: payload.date, start: payload.start_time, end: payload.end_time, _id: tempId });
    else if(type === 'special_ot') localArray.push({ name: payload.name, id: payload.emp_id, date: payload.date, start: payload.start_time, end: payload.end_time, hours: payload.hours, _id: tempId });
    else localArray.push({ name: payload.name, id: payload.emp_id, date: payload.date, type: payload.type, hours: payload.hours, _id: tempId });
    renderExtraTables();

    const { data, error } = await dbClient.from(table).insert(payload).select();
    if(!error && data && data.length > 0) {
        const realItem = localArray.find(item => item._id === tempId);
        if(realItem) realItem._id = data[0].id;
    }
}

async function delExtra(type, dbId, idx) {
    let table = type === 'cross' ? 'cross_list' : type === 'makeup' ? 'makeup_list' : type === 'special_ot' ? 'special_ot_list' : type === 'duty' ? 'duty_list' : 'leave_list';
    if(confirm('确认删除该记录？')) { 
        let backup = null;
        if(type === 'cross') { backup = crossData[idx]; crossData.splice(idx, 1); }
        else if(type === 'makeup') { backup = makeupData[idx]; makeupData.splice(idx, 1); }
        else if(type === 'special_ot') { backup = specialOtData[idx]; specialOtData.splice(idx, 1); }
        else if(type === 'duty') { backup = dutyData[idx]; dutyData.splice(idx, 1); }
        else { backup = leaveData[idx]; leaveData.splice(idx, 1); }
        renderExtraTables();

        if(dbId && !dbId.startsWith('temp_')) {
            const { error } = await dbClient.from(table).delete().eq('id', dbId); 
            if(error) {
                alert('删除失败');
                if(type === 'cross') crossData.splice(idx, 0, backup);
                else if(type === 'makeup') makeupData.splice(idx, 0, backup);
                else if(type === 'special_ot') specialOtData.splice(idx, 0, backup);
                else if(type === 'duty') dutyData.splice(idx, 0, backup);
                else leaveData.splice(idx, 0, backup);
                renderExtraTables();
            }
        }
    }
}

// ========== 5. 渲染业务数据 ==========
function getDailyRecords(person, dateStr) {
    const name = cleanStr(person['人员姓名']);
    const id = cleanStr(person['集团工号']);
    const realId = cleanStr(person['工号']); 
    
    let dayRecs = [];
    if (recordsIndex[`${id}_${dateStr}`]) dayRecs = [...recordsIndex[`${id}_${dateStr}`]];
    else if (recordsIndex[`${realId}_${dateStr}`]) dayRecs = [...recordsIndex[`${realId}_${dateStr}`]];
    else if (recordsIndex[`${name}_${dateStr}`]) dayRecs = [...recordsIndex[`${name}_${dateStr}`]];
    
    let dayRecsMin = dayRecs.map(t => timeToMinutes(t));

    const makeup = makeupData.find(m => m.date === dateStr && (m.id === id || m.id === realId || m.name === name));
    let makeStart = null, makeEnd = null;
    if (makeup) {
        if (makeup.start) makeStart = timeToMinutes(makeup.start);
        if (makeup.end) makeEnd = timeToMinutes(makeup.end);
    }

    // ====== 1. 处理上班时间 ======
    let cardStart = null;
    if (dayRecsMin.length > 0) { 
        dayRecsMin.sort((a,b)=>a-b); 
        cardStart = dayRecsMin[0]; 
    }

    let rawStart = null;
    let start = null;

    // 打卡向上取整规则：加 0.01 分钟（约 0.6 秒），确保 8:00:00 也能精确进位到 8:30:00
    const roundUpCard = (min) => Math.ceil((min + 0.01) / 30) * 30;

    if (makeStart !== null && cardStart !== null) {
        rawStart = Math.min(makeStart, cardStart);
        if (rawStart === makeStart) {
            start = makeStart; // 补卡时间原样算，不向上取整
        } else {
            start = roundUpCard(cardStart); // 原始打卡向上取整
        }
    } else if (makeStart !== null) {
        rawStart = makeStart;
        start = makeStart; // 只有补卡，原样算
    } else if (cardStart !== null) {
        rawStart = cardStart;
        start = roundUpCard(cardStart); // 只有原始打卡，向上取整
    }

    // ====== 2. 处理下班时间 ======
    let cardEnd = null;
    if (dayRecsMin.length > 0) {
        cardEnd = dayRecsMin[dayRecsMin.length - 1];
    }

    const nextDate = new Date(dateStr); nextDate.setDate(nextDate.getDate() + 1); const nextDateStr = nextDate.toISOString().split('T')[0];
    
    // 判断是否值班（值班优先级高于跨天）
    const isDuty = dutyData.some(d => d.date === dateStr && (d.id === id || d.id === realId || d.name === name));
    const isCross = crossData.find(c => c.date === dateStr && (c.id === id || c.id === realId || c.name === name));
    
    if (isCross && !isDuty) {
        let nextRecs = [];
        if (recordsIndex[`${id}_${nextDateStr}`]) nextRecs = [...recordsIndex[`${id}_${nextDateStr}`]];
        else if (recordsIndex[`${realId}_${nextDateStr}`]) nextRecs = [...recordsIndex[`${realId}_${nextDateStr}`]];
        else if (recordsIndex[`${name}_${nextDateStr}`]) nextRecs = [...recordsIndex[`${name}_${nextDateStr}`]];
        
        nextRecs = nextRecs.map(t => timeToMinutes(t)).sort((a,b)=>a-b);
        if (nextRecs.length > 0) {
            cardEnd = nextRecs[0] + 24 * 60; // 次日首卡算作今天的下班
        }
    }

    let rawEnd = null;
    let end = null;

    // 下班一律向下取整，严格保留 17:00:00
    const roundDown = (min) => Math.floor(min / 30) * 30;
    const wEnd = timeToMinutes(workEndTime);

    if (isDuty) {
        // 【值班逻辑】只找标准下班时间(如17:00)及之前的卡
        let validCards = dayRecsMin.filter(t => t <= wEnd);
        let validMakeEnd = (makeEnd !== null && makeEnd <= wEnd) ? makeEnd : null;
        
        if (validCards.length > 0 || validMakeEnd !== null) {
            // 如果17:00前有原始卡或补卡，强行按17:00下班算，且不算早退
            rawEnd = wEnd; 
            end = wEnd; 
        } else {
            // 如果17:00前没有卡，算缺卡（即使晚上有卡也不认）
            rawEnd = null;
            end = null;
        }
    } else {
        // 常规逻辑
        if (makeEnd !== null && cardEnd !== null) {
            rawEnd = Math.max(makeEnd, cardEnd);
            end = roundDown(rawEnd);
        } else if (makeEnd !== null) {
            rawEnd = makeEnd;
            end = roundDown(makeEnd);
        } else if (cardEnd !== null) {
            rawEnd = cardEnd;
            end = roundDown(cardEnd);
        }
    }

    // ====== 3. 出差兜底逻辑 ======
    const isTrip = leaveData.some(l => l.date === dateStr && l.type === '出差' && (l.id === id || l.id === realId || l.name === name));
    if (isTrip) {
        const wStart = timeToMinutes(workStartTime);
        if (start === null) { start = wStart; rawStart = wStart; }
        if (end === null) { end = wEnd; rawEnd = wEnd; }
    }

    return { start, end, rawStart, rawEnd };
}

function calcDailyHours(startMin, endMin, isWorkdayFlag) {
    if (startMin === null || endMin === null) return { normal: 0, overtime: 0, workDuration: 0 };
    const wStart = timeToMinutes(workStartTime); const wEnd = timeToMinutes(workEndTime);
    const lStart = timeToMinutes(lunchStart); const lEnd = timeToMinutes(lunchEnd);
    let normal = 0, overtime = 0;

    if (isWorkdayFlag) {
        let dur1 = Math.max(0, Math.min(endMin, lStart) - Math.max(startMin, wStart));
        let dur2 = Math.max(0, Math.min(endMin, wEnd) - Math.max(startMin, lEnd));
        normal = (dur1 + dur2) / 60; 
        
        let otStart = Math.max(wEnd, startMin);
        if (endMin > otStart) overtime += (endMin - otStart) / 60;
        
        if (overtime > 14) overtime = 14; 
        
        normal = Math.floor(normal * 2) / 2; 
        if (overtime >= 1) overtime = Math.floor(overtime * 2) / 2; else overtime = 0;
        
    } else {
        let dur1 = Math.max(0, Math.min(endMin, lStart) - Math.max(startMin, wStart));
        let dur2 = Math.max(0, endMin - Math.max(startMin, lEnd));
        overtime = (dur1 + dur2) / 60;
        
        if (overtime > 22) overtime = 22;
        if (overtime >= 1) overtime = Math.floor(overtime * 2) / 2; else overtime = 0;
    }
    return { normal, overtime, workDuration: normal + overtime };
}

function closeCalcResult() {
    document.getElementById('calcResultWrapper').style.display = 'none';
}

function calculateOvertimePay() {
    const name = cleanStr(document.getElementById('calcName').value);
    const empId = cleanStr(document.getElementById('calcEmpId').value);
    const monthStr = document.getElementById('calcMonth').value;
    const wrapper = document.getElementById('calcResultWrapper');
    const resultDiv = document.getElementById('calcResult');
    
    if (!name || !monthStr) return alert('请输入姓名并选择月份');
    
    let person = rosterData.find(r => (r['人员姓名'] === name && r['工号'] === empId) || (r['人员姓名'] === name && !empId));
    if (!person) return alert('未在名单中找到该人员，请检查姓名或工号');
    
    const [year, month] = monthStr.split('-');
    const daysInMonth = new Date(year, month, 0).getDate();
    
    let totalPay = 0;
    let details = [];
    
    const baseSalary = 2200;
    const daysPerMonth = 21.75;
    const hoursPerDay = 8;
    const hourlyRate = baseSalary / daysPerMonth / hoursPerDay; 
    
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthStr}-${d.toString().padStart(2,'0')}`;
        const isW = isWorkday(dateStr);
        const otType = getOvertimeType(dateStr);
        
        const recs = getDailyRecords(person, dateStr);
        const hours = calcDailyHours(recs.start, recs.end, isW);
        
        let specialOtHours = 0;
        specialOtData.forEach(s => {
            if(s.date === dateStr && (s.name === person['人员姓名'] || s.id === person['集团工号'] || s.id === person['工号'])) {
                specialOtHours += parseFloat(s.hours) || 0;
            }
        });
        
        const ot = hours.overtime + specialOtHours; 
        
        if (ot > 0) {
            let dayPay = 0;
            let rateText = "";
            
            if (otType === 1) {
                dayPay = ot * hourlyRate * 1.5;
                rateText = "工作日 1.5倍";
            } else if (otType === 3) {
                let part1 = Math.min(ot, 8);
                let part2 = Math.max(ot - 8, 0);
                dayPay = (part1 * hourlyRate * 3) + (part2 * hourlyRate * 1.5);
                rateText = `法定节假日 (${part1}h*3倍 + ${part2}h*1.5倍)`;
            } else {
                let part1 = Math.min(ot, 8);
                let part2 = Math.max(ot - 8, 0);
                dayPay = (part1 * hourlyRate * 2) + (part2 * hourlyRate * 1.5);
                rateText = `周末/休息日 (${part1}h*2倍 + ${part2}h*1.5倍)`;
            }
            
            totalPay += dayPay;
            details.push(`${d}号(${rateText}): ${ot}h = ¥${dayPay.toFixed(2)}`);
        }
    }
    
    wrapper.style.display = 'block';
    resultDiv.innerHTML = `总加班费：¥${totalPay.toFixed(2)} <span style="font-size:13px; color:#666; font-weight:normal;">(时薪: ¥${hourlyRate.toFixed(2)}/h)</span>`;
    
    if (details.length > 0) {
        resultDiv.innerHTML += `<div class="calc-details">${details.join('<br>')}</div>`;
    } else {
        resultDiv.innerHTML += `<div class="calc-details">该月无加班记录。</div>`;
    }
}

function toggleDateMode() {
    const mode = document.querySelector('input[name="dateMode"]:checked').value;
    document.getElementById('queryDate').style.display = mode === 'single' ? 'inline-block' : 'none';
    document.getElementById('queryMonth').style.display = mode === 'month' ? 'inline-block' : 'none';
    renderAttendanceTable();
}

function renderAttendanceTable() {
    const mode = document.querySelector('input[name="dateMode"]:checked').value;
    const showGaye = document.getElementById('showGaye').checked;
    currentFilter = document.querySelector('input[name="viewFilter"]:checked').value;

    let datesToQuery = [];
    if (mode === 'single') {
        const dateStr = document.getElementById('queryDate').value;
        if (!dateStr) return;
        datesToQuery.push(dateStr);
    } else {
        const monthStr = document.getElementById('queryMonth').value;
        if (!monthStr) return;
        const [year, month] = monthStr.split('-');
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            datesToQuery.push(`${monthStr}-${d.toString().padStart(2, '0')}`);
        }
    }

    let abnormalList = [];
    datesToQuery.forEach(dateStr => {
        const isW = isWorkday(dateStr);
        if (!isW) return; 

        rosterData.forEach(person => {
            const name = cleanStr(person['人员姓名']); 
            const groupId = cleanStr(person['集团工号']); 
            const empId = cleanStr(person['工号']);
            if(!name) return;

            const remark = String(person['备注'] || '').trim();
            if (!showGaye && remark.includes('伽耶')) return;

            if (leaveData.some(l => l.date === dateStr && (l.name === name || l.id === groupId || l.id === empId))) return; 

            const recs = getDailyRecords(person, dateStr);
            let issues = [];
            let startStr = recs.rawStart !== null ? formatMinToTime(recs.rawStart) : "无";
            let endStr = recs.rawEnd !== null ? formatMinToTime(recs.rawEnd) : "无";

            if (recs.start === null) issues.push("缺上班卡");
            else if (recs.start > timeToMinutes(workStartTime)) issues.push(`上班迟到`);

            if (recs.end === null) issues.push("缺下班卡");
            else if (recs.end < timeToMinutes(workEndTime)) issues.push(`下班早退`);

            if (issues.length > 0) {
                abnormalList.push({ 
                    "日期": dateStr, 
                    "科室": person['科室'] || '未知', 
                    "姓名": name, 
                    "工号": empId, 
                    "集团工号": groupId, 
                    "上班打卡": startStr, 
                    "下班打卡": endStr, 
                    "异常原因": issues.join(" | "), 
                    _issues: issues 
                });
            }
        });
    });

    if (currentFilter === 'workstart') abnormalList = abnormalList.filter(r => r._issues.some(i => i.includes('上班') || i.includes('缺上')));
    else if (currentFilter === 'workend') abnormalList = abnormalList.filter(r => r._issues.some(i => i.includes('下班') || i.includes('缺下')));

    currentAttendanceResult = abnormalList;
    const container = document.getElementById('resultContainer');
    const summary = document.getElementById('summaryText');

    summary.innerHTML = `<span class="abnormal-text">共 ${abnormalList.length} 条异常记录</span>`;
    
    const tag = document.getElementById('dayTypeTag');
    if (mode === 'month') {
        tag.textContent = '整月汇总';
        tag.style.background = '#e8f6f3'; tag.style.color = '#006064';
    } else {
        const isW = isWorkday(datesToQuery[0]);
        if (isW) { tag.textContent = '工作日'; tag.style.background = '#d4edda'; tag.style.color = '#155724'; }
        else { tag.textContent = '非工作日'; tag.style.background = '#fff3cd'; tag.style.color = '#856404'; }
    }

    if (mode === 'single' && !isWorkday(datesToQuery[0])) { 
        container.innerHTML = '<p class="empty-text">非工作日不判断异常。</p>'; 
        return; 
    }

    if (abnormalList.length === 0) { 
        container.innerHTML = '<p class="empty-text" style="color:#27ae60;">无考勤异常。</p>'; 
        return; 
    }

    let html = '<table><thead><tr><th>日期</th><th>科室</th><th>姓名</th><th>工号</th><th>集团工号</th><th>上班打卡</th><th>下班打卡</th><th>异常原因</th></tr></thead><tbody>';
    abnormalList.forEach(row => { 
        html += `<tr><td>${row['日期']}</td><td>${row['科室']}</td><td>${row['姓名']}</td><td>${row['工号']}</td><td>${row['集团工号']}</td><td>${row['上班打卡']}</td><td>${row['下班打卡']}</td><td class="abnormal-text">${row['异常原因']}</td></tr>`; 
    });
    container.innerHTML = html + '</tbody></table>';
}

function formatMinToTime(min) {
    if(min === null || isNaN(min)) return "无";
    const totalSeconds = Math.round(min * 60);
    let h = Math.floor(totalSeconds / 3600) % 24;
    let m = Math.floor((totalSeconds % 3600) / 60);
    let s = totalSeconds % 60;
    
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function exportAbnormal() {
    if(currentAttendanceResult.length === 0) return;
    const exportData = currentAttendanceResult.map(r => ({ 
        "日期": r['日期'], "科室": r['科室'], "姓名": r['姓名'], "工号": r['工号'], "集团工号": r['集团工号'], "上班打卡": r['上班打卡'], "下班打卡": r['下班打卡'], "异常原因": r['异常原因'] 
    }));
    const csv = Papa.unparse(exportData);
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); 
    const mode = document.querySelector('input[name="dateMode"]:checked').value;
    const dateLabel = mode === 'single' ? document.getElementById('queryDate').value : document.getElementById('queryMonth').value;
    link.download = `考勤异常_${dateLabel}.csv`; link.click();
}

function renderDetailTable(type) {
    const monthInput = type === 'ot' ? 'otMonth' : 'normalMonth';
    const container = type === 'ot' ? 'otResultContainer' : 'normalResultContainer';
    const searchInput = type === 'ot' ? 'otSearchName' : 'normalSearchName';
    const excludeInput = type === 'ot' ? 'otExcludeNames' : 'normalExcludeNames';
    const tagSpan = type === 'ot' ? 'otDisplayMonth' : 'normalDisplayMonth';
    
    const monthStr = document.getElementById(monthInput).value; 
    const searchKw = document.getElementById(searchInput).value.trim();
    const excludeKw = document.getElementById(excludeInput).value.trim();

    const searchList = searchKw ? searchKw.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];
    const excludeList = excludeKw ? excludeKw.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];

    if (!monthStr) return alert('请选择月份');
    
    document.getElementById(container).innerHTML = '<p class="empty-text">正在计算，请稍候...</p>';
    const tagEl = document.getElementById(tagSpan);
    tagEl.style.display = 'none';
    
    setTimeout(() => {
        const [year, month] = monthStr.split('-');
        const daysInMonth = new Date(year, month, 0).getDate();
        
        let html = `<table class="detail-table"><thead><tr><th>序号</th><th>工号</th><th>集团工号</th><th>姓名</th><th>类型</th>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${monthStr}-${d.toString().padStart(2,'0')}`; const isW = isWorkday(dateStr);
            html += `<th class="${isW ? '' : 'weekend-col'}">${d}<br><span style="font-size:11px">${isW?'一':'休'}</span></th>`;
        }
        
        if (type === 'ot') {
            html += `<th>总加班<br>(h)</th><th>补卡<br>次数</th><th>请假<br>次数</th><th>缺勤<br>(h)</th>`;
        } else {
            html += `<th>总出勤<br>(h)</th><th>餐补<br>(元)</th>`;
        }
        html += `</tr></thead><tbody>`;

        let displayIdx = 1; 
        rosterData.forEach((person) => {
            const name = cleanStr(person['人员姓名']); const groupId = cleanStr(person['集团工号']); const empId = cleanStr(person['工号']);
            if(!name) return;

            if (searchList.length > 0 && !searchList.some(s => name.includes(s))) return;
            if (excludeList.length > 0 && excludeList.some(s => name.includes(s))) return;

            html += `<tr><td>${displayIdx++}</td><td>${empId}</td><td>${groupId}</td><td>${name}</td><td style="color:${type==='ot'?'#d35400':'#27ae60'}">${type==='ot'?'加班':'出勤'}</td>`;
            
            let totalHours = 0, totalMakeup = 0, totalLeave = 0, totalAbsent = 0, totalMeal = 0;
            
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${monthStr}-${d.toString().padStart(2,'0')}`; const isW = isWorkday(dateStr);
                
                const dayExtras = leaveData.filter(l => l.date === dateStr && (l.name === name || l.id === groupId || l.id === empId));
                const leaveRec = dayExtras.find(l => l.type !== '出差');
                const tripRec = dayExtras.find(l => l.type === '出差');
                
                let leaveHours = leaveRec ? parseFloat(leaveRec.hours) || 0 : 0; 
                let leaveType = leaveRec ? leaveRec.type : '';
                if (leaveHours > 0) totalLeave++;

                const recs = getDailyRecords(person, dateStr); const hours = calcDailyHours(recs.start, recs.end, isW);
                
                let specialOtHours = 0;
                specialOtData.forEach(s => {
                    if(s.date === dateStr && (s.name === name || s.id === groupId || s.id === empId)) {
                        specialOtHours += parseFloat(s.hours) || 0;
                    }
                });

                let cellHtml = ''; let displayVal = 0;
                
                if (type === 'ot') {
                    displayVal = hours.overtime + specialOtHours; 
                    totalHours += displayVal;
                    if (makeupData.find(m => m.date === dateStr && (m.name === name || m.id === groupId || m.id === empId))) totalMakeup++;
                    if (isW) { let absent = 8 - hours.normal - leaveHours; if (absent > 0) totalAbsent += absent; }
                } else { 
                    displayVal = hours.workDuration + specialOtHours; 
                    totalHours += displayVal; 
                    
                    if (displayVal >= 10) {
                        totalMeal += 22;
                    } else if (displayVal >= 4) {
                        totalMeal += 12;
                    }
                }

                if (displayVal > 0) {
                    let titleStr = `上班: ${recs.rawStart !== null ? formatMinToTime(recs.rawStart) : '无'}\n下班: ${recs.rawEnd !== null ? formatMinToTime(recs.rawEnd) : '无'}`;
                    if (specialOtHours > 0) titleStr += `\n特殊加班: ${specialOtHours}h`;
                    cellHtml = `<div class="cell-content" title="${titleStr}"><span class="cell-num ${type==='ot'?'cell-ot':'cell-normal'}">${displayVal}</span></div>`;
                }

                if (type === 'normal') {
                    if (leaveHours > 0 && leaveType) {
                        const shortType = leaveType.charAt(0); 
                        cellHtml += `<div class="cell-leave">${shortType}${leaveHours}h</div>`;
                    }
                    if (tripRec) {
                        cellHtml += `<div class="cell-trip">出差</div>`;
                    }
                    if (isW && recs.start !== null && recs.end === null && leaveHours === 0 && !tripRec) {
                        cellHtml += `<div class="cell-abnormal">缺卡</div>`;
                    }
                }
                
                html += `<td class="${isW ? '' : 'weekend-col'}">${cellHtml}</td>`;
            }
            
            if (type === 'ot') {
                html += `<td style="font-weight:bold; background:#fff3cd;">${totalHours.toFixed(1)}</td><td>${totalMakeup}</td><td>${totalLeave}</td><td style="color:#e74c3c; font-weight:bold;">${totalAbsent > 0 ? totalAbsent.toFixed(1) : '0'}</td>`;
            } else { 
                html += `<td style="font-weight:bold; background:#d4edda;">${totalHours.toFixed(1)}</td>`;
                html += `<td style="font-weight:bold; background:#fcf3cf; color:#d35400;">${totalMeal}</td>`;
            }
            html += `</tr>`;
        });
        html += `</tbody></table>`;
        document.getElementById(container).innerHTML = html;
        
        tagEl.textContent = `当前显示：${year}年${month}月`;
        tagEl.style.display = 'inline-block';
        
    }, 50); 
}

function exportDetailTable(type) {
    const monthInput = type === 'ot' ? 'otMonth' : 'normalMonth'; const searchInput = type === 'ot' ? 'otSearchName' : 'normalSearchName';
    const excludeInput = type === 'ot' ? 'otExcludeNames' : 'normalExcludeNames';
    
    const monthStr = document.getElementById(monthInput).value; 
    const searchKw = document.getElementById(searchInput).value.trim();
    const excludeKw = document.getElementById(excludeInput).value.trim();

    const searchList = searchKw ? searchKw.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];
    const excludeList = excludeKw ? excludeKw.split(/[,，]/).map(s => s.trim()).filter(s => s) : [];

    if(!monthStr) return alert('请选择月份');
    const [year, month] = monthStr.split('-'); const daysInMonth = new Date(year, month, 0).getDate();
    let displayIdx = 1;
    
    const headers = ['序号', '工号', '集团工号', '姓名', '类型'];
    for(let d=1; d<=daysInMonth; d++) headers.push(`${d}`);
    
    if (type === 'ot') {
        headers.push('总加班(h)', '补卡次数', '请假次数', '缺勤时长(h)');
    } else {
        headers.push('总出勤(h)', '餐补(元)');
    }

    const csvData = [];
    rosterData.forEach(person => {
        const name = cleanStr(person['人员姓名']); const groupId = cleanStr(person['集团工号']); const empId = cleanStr(person['工号']);
        if(!name) return;

        if (searchList.length > 0 && !searchList.some(s => name.includes(s))) return;
        if (excludeList.length > 0 && excludeList.some(s => name.includes(s))) return;

        let rowArray = [displayIdx++, empId, groupId, name, type==='ot'?'加班':'常白班'];
        let totalHours = 0, totalMakeup = 0, totalLeave = 0, totalAbsent = 0, totalMeal = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${monthStr}-${d.toString().padStart(2,'0')}`; const isW = isWorkday(dateStr);
            const dayExtras = leaveData.filter(l => l.date === dateStr && (l.name === name || l.id === groupId || l.id === empId));
            const leaveRec = dayExtras.find(l => l.type !== '出差');
            let leaveHours = leaveRec ? parseFloat(leaveRec.hours) || 0 : 0; if (leaveHours > 0) totalLeave++;

            const recs = getDailyRecords(person, dateStr); const hours = calcDailyHours(recs.start, recs.end, isW);
            
            let specialOtHours = 0;
            specialOtData.forEach(s => {
                if(s.date === dateStr && (s.name === name || s.id === groupId || s.id === empId)) {
                    specialOtHours += parseFloat(s.hours) || 0;
                }
            });
            
            let displayVal = type === 'ot' ? (hours.overtime + specialOtHours) : (hours.workDuration + specialOtHours);
            totalHours += displayVal;
            
            if (type === 'ot') {
                if (makeupData.find(m => m.date === dateStr && (m.name === name || m.id === groupId || m.id === empId))) totalMakeup++;
                if (isW) { let absent = 8 - hours.normal - leaveHours; if (absent > 0) totalAbsent += absent; }
            } else {
                if (displayVal >= 10) totalMeal += 22;
                else if (displayVal >= 4) totalMeal += 12;
            }
            
            rowArray.push(displayVal > 0 ? displayVal : '');
        }
        
        if (type === 'ot') {
            rowArray.push(totalHours, totalMakeup, totalLeave, totalAbsent);
        } else {
            rowArray.push(totalHours, totalMeal);
        }
        csvData.push(rowArray);
    });

    const csv = Papa.unparse({ fields: headers, data: csvData });
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${type === 'ot' ? '加班明细表' : '出勤明细表'}_${monthStr}.csv`; link.click();
}

// ========== 🌟 爱心：悬停暂停 + 拖拽 + 点击弹出 ==========
function initHeartFeature() {
    const heartMover = document.getElementById('heart-mover');
    if (!heartMover) return;

    let screenWidth = window.innerWidth - 50; 
    let screenHeight = window.innerHeight - 50;

    let posX = window.innerWidth / 2 - 20;
    let posY = window.innerHeight / 2 - 20;
    
    let speedX = (Math.random() > 0.5 ? 1 : -1) * 1; 
    let speedY = (Math.random() > 0.5 ? 1 : -1) * 1;

    let isDragging = false;
    let isHovering = false;
    let hasMoved = false;
    let startMouseX, startMouseY, startPosX, startPosY;

    window.addEventListener('resize', () => {
        screenWidth = window.innerWidth - 50;
        screenHeight = window.innerHeight - 50;
    });

    function animate() {
        if (!isDragging && !isHovering) {
            posX += speedX;
            posY += speedY;

            if (posX <= 0) { posX = 0; speedX = Math.abs(speedX); } 
            else if (posX >= screenWidth) { posX = screenWidth; speedX = -Math.abs(speedX); }

            if (posY <= 0) { posY = 0; speedY = Math.abs(speedY); } 
            else if (posY >= screenHeight) { posY = screenHeight; speedY = -Math.abs(speedY); }

            heartMover.style.transform = `translate(${posX}px, ${posY}px)`;
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    heartMover.addEventListener('mouseenter', () => {
        isHovering = true;
    });

    heartMover.addEventListener('mouseleave', () => {
        isHovering = false;
    });

    heartMover.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasMoved = false;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startPosX = posX;
        startPosY = posY;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            hasMoved = true;
        }
        
        if (hasMoved) {
            posX = startPosX + dx;
            posY = startPosY + dy;
            heartMover.style.transform = `translate(${posX}px, ${posY}px)`;
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';

        if (hasMoved) {
            if (posX < 0) posX = 0;
            if (posX > screenWidth) posX = screenWidth;
            if (posY < 0) posY = 0;
            if (posY > screenHeight) posY = screenHeight;

            speedX = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 1);
            speedY = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 1);
        } else {
            const randomQuote = loveQuotes[Math.floor(Math.random() * loveQuotes.length)] || "❤️";
            showPopupText(posX, posY, randomQuote);
        }
    });

    function showPopupText(x, y, text) {
        const popup = document.createElement('div');
        popup.className = 'popup-message';
        popup.textContent = text;

        popup.style.left = `${x}px`;
        popup.style.top = `${y - 40}px`;

        document.body.appendChild(popup);

        setTimeout(() => popup.remove(), 4000);
    }
}

// ========== 启动 ==========
window.addEventListener('load', initSupabase);
