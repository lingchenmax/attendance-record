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

window.addEventListener('unhandledrejection', function(event) {
    console.error("未处理的异步错误:", event.reason);
});

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
        setTimeout(() => { maybeOpenInviteRoom(); }, 200);
        
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

        const { data: gates } = await dbClient.from('gates').select('name');
        let gateList = gates || [];
        if(gates && gates.length === 0 && isAdmin) {
            const defaultGates = ["办公楼1楼东南楼梯口考勤_门_1", "办公楼1楼东北楼梯口考勤_门_1", "办公楼1F电梯口考勤_门_1", "3厂预处理车间门口考勤机_门_1", "办公楼1楼前台考勤_门_1", "设备动力二层楼考勤机_门_1", "3厂分段车间东外墙考勤_门_1"];
            await dbClient.from('gates').insert(defaultGates.map(g => ({ name: g })));
            gateList = defaultGates.map(g => ({name: g}));
        }
        gatesData = gateList.map(g => g.name);

        await loadRosterData();

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
        crossData = (cross || []).map(c => ({ name: c.name, id: c.emp_id, date: c.date, remark: c.remark, _id: c.id }));

        let makeupQuery = dbClient.from('makeup_list').select('*');
        if(!isAdmin) makeupQuery = makeupQuery.eq('emp_id', myEmpId);
        const { data: makeup } = await makeupQuery;
        makeupData = (makeup || []).map(m => ({ name: m.name, id: m.emp_id, date: m.date, start: m.start_time, end: m.end_time, _id: m.id }));

        let leaveQuery = dbClient.from('leave_list').select('*');
        if(!isAdmin) leaveQuery = leaveQuery.eq('emp_id', myEmpId);
        const { data: leave } = await leaveQuery;
        leaveData = (leave || []).map(l => ({ name: l.name, id: l.emp_id, date: l.date, type: l.type, hours: l.hours, _id: l.id }));

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
async function loadRosterData() {
    const { data: roster, error } = await dbClient.from('roster').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    rosterData = (roster || []).map(r => ({
        '序号': r.sort_order || 0, '科室': r.dept, '人员姓名': r.name, '工号': r.emp_id, '集团工号': r.group_id, '备注': r.remark, _id: r.id
    }));
    renderRosterNamesDatalist();
}

function cleanStr(str) { return String(str || "").replace(/[\s\u3000]/g, '').trim(); }

function groupByDate(list) {
    const map = new Map();
    (list || []).forEach(item => {
        const key = item.date;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    });
    return map;
}

function buildIdIndex(list) {
    const map = new Map();
    (list || []).forEach((item, idx) => map.set(item._id, idx));
    return map;
}
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
// 模块切换：考勤系统 / 其他功能（其他功能仅管理员可用）
function switchModule(moduleName) {
    if (moduleName === 'other' && !isAdmin) return;
    const isOther = moduleName === 'other';
    document.getElementById('module-attendance').style.display = isOther ? 'none' : 'block';
    document.getElementById('module-other').style.display = isOther ? 'block' : 'none';

    const btnAttendance = document.getElementById('btnModuleAttendance');
    const btnOther = document.getElementById('btnModuleOther');
    if (btnAttendance) btnAttendance.classList.toggle('active', !isOther);
    if (btnOther) btnOther.classList.toggle('active', isOther);
}

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

function renderRosterNamesDatalist() {
    const datalist = document.getElementById('rosterNames');
    if (!datalist) return;
    datalist.innerHTML = rosterData
        .filter(r => cleanStr(r['人员姓名']))
        .map(r => `<option value="${r['人员姓名']}">${r['工号'] || ''}</option>`)
        .join('');
}

function renderRosterTable() {
    if(!isAdmin) return; 
    const tbody = document.querySelector('#rosterTable tbody');
    if (!tbody) return;
    const keyword = document.getElementById('searchRoster').value.toLowerCase().trim();
    
    const rows = rosterData.map((p, idx) => {
        // 序号始终按当前列表位置生成，删除/排序后自动连续，不再依赖云端 sort_order
        const serial = idx + 1;
        const dept = String(p['科室'] || '').toLowerCase(); const name = String(p['人员姓名'] || '').toLowerCase();
        const empId = String(p['工号'] || '').toLowerCase(); const groupId = String(p['集团工号'] || '').toLowerCase();

        if (keyword && !dept.includes(keyword) && !name.includes(keyword) && !empId.includes(keyword) && !groupId.includes(keyword)) return '';

        if (p._isEditing) {
            return `<tr>
                <td><input type="number" id="edit-sort-${idx}" value="${p._id ? serial : ''}" style="width:60px;"></td>
                <td><input type="text" id="edit-dept-${idx}" value="${p['科室']||''}"></td>
                <td><input type="text" id="edit-name-${idx}" value="${p['人员姓名']||''}"></td>
                <td><input type="text" id="edit-empid-${idx}" value="${p['工号']||''}"></td>
                <td><input type="text" id="edit-groupid-${idx}" value="${p['集团工号']||''}"></td>
                <td><input type="text" id="edit-remark-${idx}" value="${p['备注']||''}"></td>
                <td><button class="success" onclick="saveRosterEdit(${idx})" style="padding:4px 8px;">保存</button><button class="danger" onclick="cancelRosterEdit(${idx})" style="padding:4px 8px;">取消</button></td>
            </tr>`;
        }
        return `<tr>
            <td>${serial}</td>
            <td>${p['科室']||''}</td><td>${p['人员姓名']||''}</td><td>${p['工号']||''}</td><td>${p['集团工号']||''}</td><td>${p['备注']||''}</td>
            <td><button onclick="editRoster(${idx})" style="padding:4px 8px; background:#f39c12;">修改</button><button class="danger" onclick="deleteRoster(${idx}, ${p._id})" style="padding:4px 8px;">删除</button></td>
        </tr>`;
    });
    tbody.innerHTML = rows.join('');
}

// 按当前列表顺序把序号重排为 1..n，并把变化的行用一次请求同步到云端
async function normalizeRosterSort() {
    const changes = [];
    rosterData.forEach((p, idx) => {
        const target = idx + 1;
        if (p['序号'] !== target) {
            p['序号'] = target;
            if (p._id) changes.push({
                id: p._id,
                sort_order: target,
                dept: p['科室'],
                name: p['人员姓名'],
                emp_id: p['工号'],
                group_id: p['集团工号'],
                remark: p['备注']
            });
        }
    });
    if (changes.length === 0) return true;
    const { error } = await dbClient.from('roster').upsert(changes, { onConflict: 'id' });
    if (error) {
        console.error('人员序号同步失败:', error);
        return false;
    }
    return true;
}

// 人员名单变化后，已生成的统计表需要重新计算，避免列表与统计口径不一致
function refreshRosterDependentViews() {
    renderAttendanceTable();
    if (document.getElementById('otMonth').value && document.querySelector('#otResultContainer table.detail-table')) renderDetailTable('ot');
    if (document.getElementById('normalMonth').value && document.querySelector('#normalResultContainer table.detail-table')) renderDetailTable('normal');
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
    if (!p) return;
    const newSortStr = document.getElementById(`edit-sort-${idx}`).value;
    const parsedSort = parseInt(newSortStr, 10);
    const newSort = Number.isFinite(parsedSort) && parsedSort > 0 ? parsedSort : 0;

    const inputState = {
        '科室': document.getElementById(`edit-dept-${idx}`).value,
        '人员姓名': document.getElementById(`edit-name-${idx}`).value,
        '工号': document.getElementById(`edit-empid-${idx}`).value,
        '集团工号': document.getElementById(`edit-groupid-${idx}`).value,
        '备注': document.getElementById(`edit-remark-${idx}`).value
    };
    const oldSort = p['序号'];
    const oldState = {
        '序号': oldSort, '科室': p['科室'], '人员姓名': p['人员姓名'],
        '工号': p['工号'], '集团工号': p['集团工号'], '备注': p['备注'], '_isEditing': p._isEditing
    };
    const oldList = rosterData.slice();
    const isNew = !p._id;

    // 先本地生效：立即关闭编辑行、按位置重排序号，不等云端往返
    Object.assign(p, inputState);
    delete p._isEditing;
    if (newSort > 0 && (isNew || newSort !== oldSort)) {
        rosterData.splice(rosterData.indexOf(p), 1);
        rosterData.splice(Math.min(newSort - 1, rosterData.length), 0, p);
    }
    renderRosterTable();
    renderRosterNamesDatalist();

    try {
        if (newSort > 0 && newSort !== oldSort) {
            const { data: conflictList } = await dbClient.from('roster').select('id, sort_order').gte('sort_order', newSort);
            if (conflictList && conflictList.length > 0) {
                for (let item of conflictList) {
                    await dbClient.from('roster').update({ sort_order: item.sort_order + 1 }).eq('id', item.id);
                }
            }
        }

        const updated = {
            sort_order: newSort,
            dept: inputState['科室'],
            name: inputState['人员姓名'],
            emp_id: inputState['工号'],
            group_id: inputState['集团工号'],
            remark: inputState['备注']
        };

        if (isNew) {
            const { data, error } = await dbClient.from('roster').insert(updated).select();
            if (error) throw error;
            if (data && data.length > 0) p._id = data[0].id;
        } else {
            const { error } = await dbClient.from('roster').update(updated).eq('id', p._id);
            if (error) throw error;
        }
    } catch (e) {
        console.error('保存人员失败:', e);
        Object.assign(p, oldState);
        rosterData = oldList;
        renderRosterTable();
        renderRosterNamesDatalist();
        alert('保存失败：' + (e.message || '网络异常'));
        return;
    }

    // 云端已保存，序号归一化只发一次请求；统计刷新放到列表绘制之后
    if (isNew && !p._id) {
        try { await loadRosterData(); } catch (e) { console.error('刷新人员名单失败:', e); }
        renderRosterTable();
        renderRosterNamesDatalist();
    }
    const synced = await normalizeRosterSort();
    if (!synced) alert('人员已保存，但云端序号同步失败，刷新页面后顺序可能不一致，请稍后重试。');
    setTimeout(refreshRosterDependentViews, 0);
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
        return;
    }
    // 删除成功后把剩余人员序号前移补齐（1..n），并同步云端
    renderRosterNamesDatalist();
    if (!(await normalizeRosterSort())) {
        alert('人员已删除，但序号同步到云端失败，请刷新页面后重试。');
    }
    renderRosterTable();
    refreshRosterDependentViews();
}

function openAddRoster() { rosterData.unshift({ '科室': '', '人员姓名': '', '工号': '', '集团工号': '', '备注': '', _isEditing: true }); renderRosterTable(); }

function uploadRoster(e) {
    const file = e.target.files[0];
    if(!file) return;
    e.target.value = '';
    readExcel(file, async (data) => {
        const toUpload = [];
        data.forEach((row, index) => {
            const name = String(row['人员姓名'] || '').trim();
            if (!name) return; // 跳过没有姓名的空行，避免导入脏数据
            const parsedSort = parseInt(row['序号'], 10);
            toUpload.push({
                sort_order: Number.isFinite(parsedSort) && parsedSort > 0 ? parsedSort : index + 1,
                dept: row['科室'] || '', name: name, emp_id: row['工号'] || '', group_id: row['集团工号'] || '', remark: row['备注'] || ''
            });
        });

        if (toUpload.length === 0) return alert('未发现有效名单数据（缺少“人员姓名”列或内容）');
        if (!confirm(`将用 ${toUpload.length} 条数据覆盖云端现有人员名单，确认继续？`)) return;

        const { error } = await dbClient.from('roster').delete().neq('id', 0);
        if (error) return alert('导入失败（清空旧名单时出错）：' + error.message);

        const { error: insErr } = await dbClient.from('roster').insert(toUpload);
        if (insErr) return alert('导入失败：' + insErr.message + '\n注意：原名单已被清空，请重新上传。');

        await loadRosterData();
        await normalizeRosterSort();
        renderRosterTable();
        refreshRosterDependentViews();
        alert('导入成功！');
    });
}

function renderGateTable() {
    if(!isAdmin) return;
    const tbody = document.querySelector('#gateTable tbody'); 
    if (!tbody) return;
    tbody.innerHTML = gatesData.map((g, idx) => `<tr><td>${g}</td><td><button class="danger" onclick="deleteGate('${g}', ${idx})" style="padding:4px 8px;">删除</button></td></tr>`).join('');
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
        const backup = gatesData[idx];
        gatesData.splice(idx, 1);
        renderGateTable();
        const { error } = await dbClient.from('gates').delete().eq('name', name); 
        if (error) {
            alert('删除失败，已恢复');
            gatesData.splice(idx, 0, backup);
            renderGateTable();
        }
    }
}

function renderExtraTables() {
    if(!isAdmin) return;

    const crossIdx = buildIdIndex(crossData);
    const makeupIdx = buildIdIndex(makeupData);
    const leaveIdx = buildIdIndex(leaveData);
    const specialOtIdx = buildIdIndex(specialOtData);
    const dutyIdx = buildIdIndex(dutyData);
    
    if(document.querySelector('#crossTable tbody')) {
        const kwCross = document.getElementById('crossSearchName').value.trim();
        const monthCross = document.getElementById('crossMonthFilter').value;
        document.querySelector('#crossTable tbody').innerHTML = crossData
            .filter(c => (!kwCross || c.name.includes(kwCross)) && (!monthCross || String(c.date).startsWith(monthCross)))
            .map((c) => {
                const realIdx = crossIdx.get(c._id);
                return `<tr><td>${c.name}</td><td>${c.id}</td><td>${c.date}</td><td>${c.remark}</td><td><button class="danger" onclick="delExtra('cross','${c._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#makeupTable tbody')) {
        const kwMakeup = document.getElementById('makeupSearchName').value.trim();
        const monthMakeup = document.getElementById('makeupMonthFilter').value;
        document.querySelector('#makeupTable tbody').innerHTML = makeupData
            .filter(m => (!kwMakeup || m.name.includes(kwMakeup)) && (!monthMakeup || String(m.date).startsWith(monthMakeup)))
            .map((m) => {
                const realIdx = makeupIdx.get(m._id);
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
                const realIdx = leaveIdx.get(l._id);
                return `<tr><td>${l.name}</td><td>${l.id}</td><td>${l.date}</td><td>${l.type}</td><td>${l.hours}</td><td><button class="danger" onclick="delExtra('leave','${l._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#tripTable tbody')) {
        const kwTrip = document.getElementById('tripSearchName').value.trim();
        const monthTrip = document.getElementById('tripMonthFilter').value;
        document.querySelector('#tripTable tbody').innerHTML = tripList
            .filter(t => (!kwTrip || t.name.includes(kwTrip)) && (!monthTrip || String(t.date).startsWith(monthTrip)))
            .map((t) => {
                const realIdx = leaveIdx.get(t._id);
                return `<tr><td>${t.name}</td><td>${t.id}</td><td>${t.date}</td><td>出差</td><td><button class="danger" onclick="delExtra('leave','${t._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#specialOtTable tbody')) {
        const kwSpecialOt = document.getElementById('specialOtSearchName').value.trim();
        const monthSpecialOt = document.getElementById('specialOtMonthFilter').value;
        document.querySelector('#specialOtTable tbody').innerHTML = specialOtData
            .filter(s => (!kwSpecialOt || s.name.includes(kwSpecialOt)) && (!monthSpecialOt || String(s.date).startsWith(monthSpecialOt)))
            .map((s) => {
                const realIdx = specialOtIdx.get(s._id);
                return `<tr><td>${s.name}</td><td>${s.id}</td><td>${s.date}</td><td>${s.start||''}</td><td>${s.end||''}</td><td>${s.hours}</td><td><button class="danger" onclick="delExtra('special_ot','${s._id}', ${realIdx})" style="padding:4px 8px;">删除</button></td></tr>`;
            }).join('');
    }

    if(document.querySelector('#dutyTable tbody')) {
        const kwDuty = document.getElementById('dutySearchName').value.trim();
        const monthDuty = document.getElementById('dutyMonthFilter').value;
        document.querySelector('#dutyTable tbody').innerHTML = dutyData
            .filter(s => (!kwDuty || s.name.includes(kwDuty)) && (!monthDuty || String(s.date).startsWith(monthDuty)))
            .map((s) => {
                const realIdx = dutyIdx.get(s._id);
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

        if(dbId && !String(dbId).startsWith('temp_')) {
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

    const leaveByDate = groupByDate(leaveData);
    let abnormalList = [];
    datesToQuery.forEach(dateStr => {
        const isW = isWorkday(dateStr);
        if (!isW) return; 

        const dayLeaves = leaveByDate.get(dateStr) || [];
        rosterData.forEach(person => {
            const name = cleanStr(person['人员姓名']); 
            const groupId = cleanStr(person['集团工号']); 
            const empId = cleanStr(person['工号']);
            if(!name) return;

            const remark = String(person['备注'] || '').trim();
            if (!showGaye && remark.includes('伽耶')) return;

            if (dayLeaves.some(l => l.name === name || l.id === groupId || l.id === empId)) return; 

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

        const datesInMonth = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${monthStr}-${d.toString().padStart(2,'0')}`;
            datesInMonth.push({ dateStr, isW: isWorkday(dateStr) });
        }
        // 按日期预分组，避免在“人员 × 日期”双重循环里反复全量扫描
        const leaveByDate = groupByDate(leaveData);
        const makeupByDate = groupByDate(makeupData);
        const specialOtByDate = groupByDate(specialOtData);

        let html = `<table class="detail-table"><thead><tr><th>序号</th><th>工号</th><th>集团工号</th><th>姓名</th><th>类型</th>`;
        datesInMonth.forEach((dt, i) => {
            html += `<th class="${dt.isW ? '' : 'weekend-col'}">${i + 1}<br><span style="font-size:11px">${dt.isW?'一':'休'}</span></th>`;
        });
        
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
            
            for (const { dateStr, isW } of datesInMonth) {
                const dayLeaves = leaveByDate.get(dateStr) || [];
                const dayMakeups = makeupByDate.get(dateStr) || [];
                const daySpecialOts = specialOtByDate.get(dateStr) || [];

                const dayExtras = dayLeaves.filter(l => l.name === name || l.id === groupId || l.id === empId);
                const leaveRec = dayExtras.find(l => l.type !== '出差');
                const tripRec = dayExtras.find(l => l.type === '出差');
                
                let leaveHours = leaveRec ? parseFloat(leaveRec.hours) || 0 : 0; 
                let leaveType = leaveRec ? leaveRec.type : '';
                if (leaveHours > 0) totalLeave++;

                const recs = getDailyRecords(person, dateStr); const hours = calcDailyHours(recs.start, recs.end, isW);
                
                let specialOtHours = 0;
                daySpecialOts.forEach(s => {
                    if(s.name === name || s.id === groupId || s.id === empId) {
                        specialOtHours += parseFloat(s.hours) || 0;
                    }
                });

                let cellHtml = ''; let displayVal = 0;
                
                if (type === 'ot') {
                    displayVal = hours.overtime + specialOtHours; 
                    totalHours += displayVal;
                    if (dayMakeups.find(m => m.name === name || m.id === groupId || m.id === empId)) totalMakeup++;
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
    const datesInMonth = [];
    for(let d=1; d<=daysInMonth; d++) {
        headers.push(`${d}`);
        datesInMonth.push({ dateStr: `${monthStr}-${d.toString().padStart(2,'0')}`, isW: isWorkday(`${monthStr}-${d.toString().padStart(2,'0')}`) });
    }
    // 按日期预分组，避免导出时在“人员 × 日期”双重循环里反复全量扫描
    const leaveByDate = groupByDate(leaveData);
    const makeupByDate = groupByDate(makeupData);
    const specialOtByDate = groupByDate(specialOtData);
    
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
        
        for (const { dateStr, isW } of datesInMonth) {
            const dayLeaves = leaveByDate.get(dateStr) || [];
            const dayMakeups = makeupByDate.get(dateStr) || [];
            const daySpecialOts = specialOtByDate.get(dateStr) || [];

            const dayExtras = dayLeaves.filter(l => l.name === name || l.id === groupId || l.id === empId);
            const leaveRec = dayExtras.find(l => l.type !== '出差');
            let leaveHours = leaveRec ? parseFloat(leaveRec.hours) || 0 : 0; if (leaveHours > 0) totalLeave++;

            const recs = getDailyRecords(person, dateStr); const hours = calcDailyHours(recs.start, recs.end, isW);
            
            let specialOtHours = 0;
            daySpecialOts.forEach(s => {
                if(s.name === name || s.id === groupId || s.id === empId) {
                    specialOtHours += parseFloat(s.hours) || 0;
                }
            });
            
            let displayVal = type === 'ot' ? (hours.overtime + specialOtHours) : (hours.workDuration + specialOtHours);
            totalHours += displayVal;
            
            if (type === 'ot') {
                if (dayMakeups.find(m => m.name === name || m.id === groupId || m.id === empId)) totalMakeup++;
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

// ========== 其他功能：娱乐（联机五子棋 / 你画我猜） ==========
// 联机状态、频道与两款游戏的逻辑集中在本文件末尾；
// 此处保留棋盘绘制与胜负判定这两个纯本地函数。

function gomokuDraw() {
    const canvas = document.getElementById('gomokuCanvas');
    if (!canvas) return;
    const size = canvas.clientWidth;
    if (!size) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#e8c98f';
    ctx.fillRect(0, 0, size, size);

    const margin = size * 0.045;
    const step = (size - margin * 2) / (GOMOKU_SIZE - 1);
    const stoneRadius = step * 0.42;

    ctx.strokeStyle = 'rgba(96, 64, 26, 0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < GOMOKU_SIZE; i++) {
        const pos = margin + i * step;
        ctx.beginPath(); ctx.moveTo(margin, pos); ctx.lineTo(size - margin, pos); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pos, margin); ctx.lineTo(pos, size - margin); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(70, 45, 15, 0.85)';
    GOMOKU_STAR_POINTS.forEach(([r, c]) => {
        ctx.beginPath();
        ctx.arc(margin + c * step, margin + r * step, Math.max(2, step * 0.08), 0, Math.PI * 2);
        ctx.fill();
    });

    const lastMove = gomokuHistory[gomokuHistory.length - 1];
    for (let r = 0; r < GOMOKU_SIZE; r++) {
        for (let c = 0; c < GOMOKU_SIZE; c++) {
            const owner = gomokuBoard[r][c];
            if (!owner) continue;
            const x = margin + c * step;
            const y = margin + r * step;
            const grad = ctx.createRadialGradient(x - stoneRadius * 0.35, y - stoneRadius * 0.35, stoneRadius * 0.15, x, y, stoneRadius);
            if (owner === 1) {
                grad.addColorStop(0, '#666');
                grad.addColorStop(1, '#111');
            } else {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, '#d6d6d6');
            }
            ctx.beginPath();
            ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = owner === 1 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.2)';
            ctx.stroke();

            if (lastMove && lastMove.row === r && lastMove.col === c) {
                ctx.beginPath();
                ctx.arc(x, y, Math.max(2, stoneRadius * 0.32), 0, Math.PI * 2);
                ctx.fillStyle = '#e74c3c';
                ctx.fill();
            }
        }
    }
}

function gomokuCheckWin(row, col, player) {
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of directions) {
        let count = 1;
        for (const sign of [1, -1]) {
            for (let k = 1; k < 5; k++) {
                const r = row + dr * k * sign;
                const c = col + dc * k * sign;
                if (r < 0 || r >= GOMOKU_SIZE || c < 0 || c >= GOMOKU_SIZE) break;
                if (gomokuBoard[r][c] !== player) break;
                count++;
            }
        }
        if (count >= 5) return true;
    }
    return false;
}

// ========== 娱乐联机实现（Supabase Realtime Broadcast） ==========
// 设计约束：
// 1) 落子、笔迹、猜词只走 Realtime Broadcast 临时消息，不写数据库；
// 2) 数据库只保存房间、座位与最终结果，写入次数极低；
// 3) 频道名使用不可猜测的房间 UUID，另用 6 位房间码便于邀请；
// 4) 断线重连时通过广播拉取房间状态兜底。

const GOMOKU_SIZE = 15;
const GOMOKU_STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
const DRAW_MAX_PLAYERS = 8;
const DRAW_ROUND_MS = 60000;
const DRAW_REVEAL_MS = 5000;
const DRAW_WORDS = [
    '太阳', '月亮', '星星', '彩虹', '雪花', '闪电', '气球', '风筝',
    '苹果', '香蕉', '西瓜', '草莓', '蛋糕', '面包', '汉堡', '冰淇淋',
    '火锅', '饺子', '咖啡', '筷子', '雨伞', '眼镜', '帽子', '鞋子',
    '手套', '手表', '钥匙', '铅笔', '书本', '电脑', '手机', '电视',
    '相机', '篮球', '足球', '乒乓球', '羽毛球', '钢琴', '吉他', '气球',
    '熊猫', '老虎', '大象', '兔子', '小狗', '小猫', '金鱼', '蝴蝶',
    '蜜蜂', '蜗牛', '章鱼', '长颈鹿', '大猩猩', '飞机', '火车', '汽车',
    '自行车', '轮船', '房子', '学校', '医院', '超市', '公园', '摩天轮',
    '长城', '金字塔', '医生', '警察', '厨师', '宇航员'
];
// 自定义题目长度上限（按字符计算，含汉字/字母/emoji 各算 1 个）
const DRAW_CUSTOM_WORD_MAX = 8;

let onlineRoom = null;
let onlinePlayers = [];
let onlineChannel = null;
let onlineMySeat = -1;
let onlineMyName = '';
let onlinePresenceUsers = {};
let onlineBusy = false;

let gomokuBoard = [];
let gomokuHistory = [];
let gomokuTurnSeat = 0;
let gomokuGameOver = false;
let gomokuWinnerSeat = -1;
let gomokuResultSaved = false;

let drawPhase = 'waiting';
let drawRound = 0;
let drawTotalRounds = 0;
let drawDrawerSeat = -1;
let drawAnswer = '';
let drawWordLength = 0;
let drawScores = {};
let drawGuessedSeats = {};
let drawStrokes = [];
const drawStrokeMap = new Map();
let drawWordChoices = [];
let drawPendingGuesses = {};
let drawRoundEndsAt = 0;
let drawTimerId = null;
let drawNextRoundTimer = null;
let drawPointerActive = false;
let drawCurrentId = null;
let drawStrokeBuffer = [];
let drawFlushTimer = null;
let drawStrokeSeq = 0;

// ---------- 通用工具 ----------
function genUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function myDisplayName() {
    if (!currentUser) return '玩家';
    const email = currentUser.email || '';
    const name = email.split('@')[0];
    return name || '玩家';
}

function roomSend(event, payload) {
    if (!onlineChannel) return;
    try {
        const task = onlineChannel.send({ type: 'broadcast', event, payload });
        if (task && typeof task.catch === 'function') task.catch(() => {});
    } catch (e) {
        console.warn('广播发送失败', event, e);
    }
}

function playerBySeat(seat) {
    return onlinePlayers.find(p => p.seat === seat) || null;
}

function seatName(seat) {
    if (seat < 0) return '—';
    const p = playerBySeat(seat);
    const base = p ? p.display_name : `座位${seat + 1}`;
    if (onlineRoom && onlineRoom.game === 'gomoku') return `${base}（${seat === 0 ? '黑' : '白'}）`;
    return base;
}

function normalizeGuess(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
}

// ---------- 房间创建 / 加入 / 离开 ----------
function describeGameError(error) {
    if (!error) return '未知错误';
    const code = String(error.code || '');
    const msg = String(error.message || error);
    if (code === '42P01' || /does not exist|could not find the table/i.test(msg)) {
        return '数据库表不存在：请先在 Supabase SQL Editor 执行 game_rooms / game_players 的建表与策略脚本。';
    }
    if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
        return '权限被拒绝：请检查两张表的 RLS 策略，以及 authenticated 角色的授权。';
    }
    if (code === '23503') {
        return '外键校验失败：host_id / user_id 必须是当前登录的 auth 用户。';
    }
    if (code === '23505' || /duplicate key/i.test(msg)) {
        return '唯一约束冲突（可能是房间码或座位重复）：' + msg;
    }
    return msg;
}

async function createOnlineRoom(game, btn) {
    if (!dbClient || !currentUser) { alert('请先登录后再创建房间'); return; }
    if (onlineBusy) return;
    onlineBusy = true;
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
    try {
        if (onlineRoom) await leaveOnlineRoom(true);

        // 关闭自己此前遗留的同类型房间，避免唯一约束冲突与脏数据
        try {
            await dbClient.from('game_rooms').delete().eq('host_id', currentUser.id).eq('game', game);
        } catch (cleanupErr) {
            console.warn('清理旧房间失败（不影响继续创建）', cleanupErr);
        }

        let roomId = genUuid();
        let code = genRoomCode();
        let lastError = null;
        for (let i = 0; i < 4; i++) {
            const { error } = await dbClient.from('game_rooms').insert({
                id: roomId,
                game,
                code,
                host_id: currentUser.id,
                status: 'waiting'
            });
            if (!error) { lastError = null; break; }
            lastError = error;
            const msg = String(error.message || '');
            if (String(error.code) === '23505' || /duplicate|unique/i.test(msg)) {
                roomId = genUuid();
                code = genRoomCode();
                continue;
            }
            break;
        }
        if (lastError) {
            const errMsg = String(lastError.message || '');
            if (String(lastError.code) === '23505' || /duplicate|unique/i.test(errMsg)) {
                // 兼容“一个账号只能有一个房间”的自定义约束：直接复用自己的已有房间
                const { data: existing } = await dbClient
                    .from('game_rooms')
                    .select('id, game, code, host_id, status')
                    .eq('host_id', currentUser.id)
                    .eq('game', game)
                    .limit(1);
                if (existing && existing.length) {
                    await enterOnlineRoom(existing[0]);
                    return;
                }
            }
            alert('创建房间失败：' + describeGameError(lastError));
            return;
        }
        await enterOnlineRoom({ id: roomId, game, code, host_id: currentUser.id, status: 'waiting' });
    } catch (e) {
        console.error('创建房间异常', e);
        alert('创建房间异常：' + describeGameError(e));
    } finally {
        onlineBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = btnText || '创建房间'; }
    }
}

async function joinRoomByCode(game, inputId, btn) {
    if (!dbClient || !currentUser) { alert('请先登录'); return; }
    if (onlineBusy) return;
    onlineBusy = true;
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '加入中...'; }
    try {
        const input = document.getElementById(inputId);
        const code = ((input && input.value) || '').trim().toUpperCase();
        if (code.length !== 6) { alert('请输入 6 位房间码'); return; }
        const { data, error } = await dbClient
            .from('game_rooms')
            .select('id, game, code, host_id, status')
            .eq('code', code)
            .maybeSingle();
        if (error) { alert('查询房间失败：' + describeGameError(error)); return; }
        if (!data) { alert('房间不存在或已关闭'); return; }
        if (data.game !== game) { alert('房间类型不匹配'); return; }
        await enterOnlineRoom(data);
    } catch (e) {
        console.error('加入房间异常', e);
        alert('加入房间异常：' + describeGameError(e));
    } finally {
        onlineBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = btnText || '加入'; }
    }
}

async function ensurePlayerSeat() {
    if (!onlineRoom || !dbClient || !currentUser) return null;
    const { data: mine } = await dbClient
        .from('game_players')
        .select('*')
        .eq('room_id', onlineRoom.id)
        .eq('user_id', currentUser.id)
        .maybeSingle();
    if (mine) return mine.seat;

    for (let attempt = 0; attempt < 6; attempt++) {
        const { data: players } = await dbClient
            .from('game_players')
            .select('seat')
            .eq('room_id', onlineRoom.id);
        const seats = (players || []).map(p => p.seat);
        if (onlineRoom.game === 'gomoku' && seats.length >= 2) {
            alert('房间已满（五子棋最多 2 人）');
            return null;
        }
        if (seats.length >= DRAW_MAX_PLAYERS) {
            alert('房间已满');
            return null;
        }
        let seat = 0;
        while (seats.includes(seat)) seat++;
        const { error } = await dbClient.from('game_players').insert({
            room_id: onlineRoom.id,
            user_id: currentUser.id,
            display_name: myDisplayName(),
            seat
        });
        if (!error) return seat;
        const msg = String(error.message || '');
        if (String(error.code) !== '23505' && !/duplicate|unique/i.test(msg)) {
            alert('加入房间失败：' + msg);
            return null;
        }
    }
    alert('座位分配冲突，请重试');
    return null;
}

async function enterOnlineRoom(room) {
    if (!dbClient || !currentUser || !room) return;
    if (onlineRoom && onlineRoom.id === room.id) { showGameRoom(); return; }
    await leaveOnlineRoom(true);

    onlineRoom = room;
    onlineMyName = myDisplayName();

    const seat = await ensurePlayerSeat();
    if (seat === null) {
        onlineRoom = null;
        return;
    }
    onlineMySeat = seat;
    await reloadRoomPlayers();
    openRoomChannel();
    showGameRoom();
}

function showGameRoom() {
    if (!onlineRoom) return;
    const layer = document.getElementById('gameRoomLayer');
    if (!layer) return;
    layer.style.display = 'flex';

    const title = document.getElementById('gameRoomTitle');
    if (title) title.textContent = onlineRoom.game === 'gomoku' ? '五子棋 · 联机对局' : '你画我猜 · 联机对局';
    const codeEl = document.getElementById('roomCodeText');
    if (codeEl) codeEl.textContent = onlineRoom.code;

    const gomokuArea = document.getElementById('gomokuOnlineArea');
    const drawArea = document.getElementById('drawOnlineArea');
    if (gomokuArea) gomokuArea.style.display = onlineRoom.game === 'gomoku' ? 'block' : 'none';
    if (drawArea) drawArea.style.display = onlineRoom.game === 'draw' ? 'block' : 'none';

    renderRoomPlayers();

    if (onlineRoom.game === 'gomoku') {
        if (!gomokuBoard || !gomokuBoard.length) gomokuResetLocal();
        gomokuUpdateInfo();
        requestAnimationFrame(gomokuDraw);
    } else {
        drawRenderAll();
        drawUpdateTopbar();
        updateDrawControls();
    }
}

async function reloadRoomPlayers() {
    if (!onlineRoom || !dbClient) return;
    const { data } = await dbClient
        .from('game_players')
        .select('*')
        .eq('room_id', onlineRoom.id)
        .order('seat', { ascending: true });
    onlinePlayers = data || [];
    renderRoomPlayers();
    gomokuUpdateInfo();
    updateDrawControls();
}

async function leaveOnlineRoom(silent) {
    const room = onlineRoom;
    const channel = onlineChannel;
    const me = currentUser;
    onlineRoom = null;
    onlineChannel = null;

    if (channel) {
        try {
            if (room && me) {
                if (room.host_id === me.id) {
                    await channel.send({ type: 'broadcast', event: 'room_closed', payload: { by: me.id } });
                } else {
                    await channel.send({ type: 'broadcast', event: 'player_leave', payload: { user_id: me.id, seat: onlineMySeat } });
                }
            }
        } catch (e) { /* 频道可能已断开 */ }
        try { await dbClient.removeChannel(channel); } catch (e) { /* ignore */ }
    }

    if (room && me && dbClient) {
        try {
            if (room.host_id === me.id) {
                await dbClient.from('game_rooms').delete().eq('id', room.id);
            } else {
                await dbClient.from('game_players').delete().eq('room_id', room.id).eq('user_id', me.id);
            }
        } catch (e) {
            console.warn('退出房间清理失败', e);
        }
    }

    resetOnlineLocalState();
    const layer = document.getElementById('gameRoomLayer');
    if (layer) layer.style.display = 'none';

    if (!silent) {
        const params = new URLSearchParams(location.search);
        if (params.get('game')) history.replaceState(null, '', location.pathname);
    }
}

function handleRoomClosed() {
    if (!onlineRoom) return;
    const ch = onlineChannel;
    onlineRoom = null;
    onlineChannel = null;
    if (ch && dbClient) dbClient.removeChannel(ch);
    resetOnlineLocalState();
    const layer = document.getElementById('gameRoomLayer');
    if (layer) layer.style.display = 'none';
    alert('房主已关闭房间');
    const params = new URLSearchParams(location.search);
    if (params.get('game')) history.replaceState(null, '', location.pathname);
}

function handlePeerLeft(seat) {
    if (!onlineRoom) return;
    if (onlineRoom.game === 'gomoku') {
        gomokuUpdateInfo();
        return;
    }
    if (drawPhase !== 'drawing' || seat !== drawDrawerSeat) return;
    const remaining = onlinePlayers
        .filter(p => p.seat !== seat && onlinePresenceUsers[p.user_id])
        .map(p => p.seat)
        .sort((a, b) => a - b);
    const controller = remaining.length ? remaining[0] : -1;
    if (onlineMySeat !== controller) return;
    const payload = {
        answer: '（绘画者已离开）',
        scores: Object.assign({}, drawScores),
        round: drawRound,
        reason: 'left'
    };
    roomSend('draw_round_end', payload);
    applyDrawRoundEnd(payload);
}

function resetOnlineLocalState() {
    onlinePlayers = [];
    onlineMySeat = -1;
    onlinePresenceUsers = {};
    gomokuResetLocal();
    drawResetLocal();
}

async function maybeOpenInviteRoom() {
    if (!dbClient || !currentUser) return;
    const params = new URLSearchParams(location.search);
    const game = params.get('game');
    const code = (params.get('code') || '').toUpperCase();
    if (!game || !code || (game !== 'gomoku' && game !== 'draw')) return;
    try {
        const { data, error } = await dbClient
            .from('game_rooms')
            .select('id, game, code, host_id, status')
            .eq('code', code)
            .maybeSingle();
        if (error) {
            alert('读取邀请房间失败：' + describeGameError(error));
            return;
        }
        if (!data) {
            alert('邀请房间不存在或已关闭');
            history.replaceState(null, '', location.pathname);
            return;
        }
        if (data.game !== game) {
            alert('邀请链接与房间类型不匹配');
            return;
        }
        await enterOnlineRoom(data);
    } catch (e) {
        console.warn('邀请进入失败', e);
        alert('进入邀请房间异常：' + describeGameError(e));
    }
}

function copyRoomInvite() {
    if (!onlineRoom) return;
    const link = `${location.origin}${location.pathname}?game=${onlineRoom.game}&code=${onlineRoom.code}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link)
            .then(() => alert('邀请链接已复制：\n' + link))
            .catch(() => prompt('请手动复制邀请链接：', link));
    } else {
        prompt('请手动复制邀请链接：', link);
    }
}

// ---------- 频道与在线状态 ----------
function openRoomChannel() {
    if (!dbClient || !onlineRoom || !currentUser) return;
    if (onlineChannel) {
        try { dbClient.removeChannel(onlineChannel); } catch (e) { /* ignore */ }
        onlineChannel = null;
    }

    const ch = dbClient.channel(`room:${onlineRoom.id}`, {
        config: { broadcast: { self: false }, presence: { key: currentUser.id } }
    });
    onlineChannel = ch;
    const me = currentUser.id;

    ch.on('broadcast', { event: 'gomoku_move' }, ({ payload }) => {
        if (payload) applyGomokuMove(payload.row, payload.col, payload.seat);
    });
    ch.on('broadcast', { event: 'gomoku_undo' }, () => gomokuApplyUndo());
    ch.on('broadcast', { event: 'gomoku_restart' }, () => gomokuApplyRestart());
    ch.on('broadcast', { event: 'gomoku_state' }, ({ payload }) => applyGomokuState(payload));
    ch.on('broadcast', { event: 'gomoku_request_state' }, ({ payload }) => {
        if (payload && payload.from !== me) sendGomokuState(payload.from);
    });

    ch.on('broadcast', { event: 'draw_game_start' }, ({ payload }) => {
        if (payload) applyDrawGameStart(payload.totalRounds);
    });
    ch.on('broadcast', { event: 'draw_round_go' }, ({ payload }) => {
        if (payload) applyDrawRoundGo(payload);
    });
    ch.on('broadcast', { event: 'draw_round_end' }, ({ payload }) => {
        if (payload) applyDrawRoundEnd(payload);
    });
    ch.on('broadcast', { event: 'draw_segment' }, ({ payload }) => {
        if (payload) drawApplySegment(payload);
    });
    ch.on('broadcast', { event: 'draw_undo' }, ({ payload }) => {
        if (payload) drawApplyUndo(payload);
    });
    ch.on('broadcast', { event: 'draw_clear' }, () => {
        drawStrokes = [];
        drawStrokeMap.clear();
        drawRenderAll();
    });
    ch.on('broadcast', { event: 'draw_guess' }, ({ payload }) => {
        if (payload) handleDrawGuess(payload);
    });
    ch.on('broadcast', { event: 'draw_guess_ok' }, ({ payload }) => {
        if (payload) applyDrawGuessOk(payload);
    });
    ch.on('broadcast', { event: 'draw_guess_miss' }, ({ payload }) => {
        if (payload) applyDrawGuessMiss(payload);
    });
    ch.on('broadcast', { event: 'draw_guess_show' }, ({ payload }) => {
        if (payload) applyDrawGuessShow(payload);
    });
    ch.on('broadcast', { event: 'draw_state' }, ({ payload }) => applyDrawState(payload));
    ch.on('broadcast', { event: 'draw_request_state' }, ({ payload }) => {
        if (payload && payload.from !== me) sendDrawState(payload.from);
    });

    ch.on('broadcast', { event: 'player_leave' }, ({ payload }) => {
        if (payload && payload.user_id === me) return;
        reloadRoomPlayers();
        if (payload) handlePeerLeft(payload.seat);
    });
    ch.on('broadcast', { event: 'room_closed' }, ({ payload }) => {
        if (payload && payload.by === me) return;
        handleRoomClosed();
    });

    ch.on('presence', { event: 'sync' }, () => syncPresence());
    ch.on('presence', { event: 'join' }, () => { syncPresence(); reloadRoomPlayers(); });
    ch.on('presence', { event: 'leave' }, () => { syncPresence(); reloadRoomPlayers(); });

    ch.subscribe(status => {
        if (status === 'SUBSCRIBED') {
            if (!onlineChannel || onlineChannel !== ch || !onlineRoom) return;
            try {
                if (typeof ch.track === 'function') {
                    ch.track({ user_id: me, name: onlineMyName, seat: onlineMySeat });
                }
            } catch (e) { /* ignore */ }
            syncPresence();
            if (onlineRoom.game === 'gomoku') requestGomokuState();
            else requestDrawState();
        }
    });
}

function syncPresence() {
    if (!onlineChannel) return;
    const state = onlineChannel.presenceState() || {};
    onlinePresenceUsers = {};
    Object.keys(state).forEach(key => {
        (state[key] || []).forEach(meta => {
            const uid = (meta && meta.user_id) || key;
            onlinePresenceUsers[uid] = true;
        });
    });
    renderRoomPlayers();
    gomokuUpdateInfo();
}

function renderRoomPlayers() {
    const listEl = document.getElementById('roomPlayersList');
    if (listEl) {
        listEl.innerHTML = '';
        onlinePlayers.forEach(p => {
            const chip = document.createElement('span');
            chip.className = 'room-player-chip' + (onlinePresenceUsers[p.user_id] ? ' online' : '');
            let label = p.seat === onlineMySeat ? `${p.display_name}（我）` : p.display_name;
            if (onlineRoom && onlineRoom.game === 'gomoku') {
                label += ` · ${p.seat === 0 ? '黑方' : '白方'}`;
            } else {
                label += ` · ${drawScores[p.seat] || 0} 分`;
                if (drawPhase !== 'waiting' && p.seat === drawDrawerSeat) label += ' · 绘画者';
            }
            chip.textContent = label;
            listEl.appendChild(chip);
        });
    }

    const statusEl = document.getElementById('roomStatusText');
    if (statusEl && onlineRoom) {
        const onlineCount = onlinePlayers.filter(p => onlinePresenceUsers[p.user_id]).length;
        const gameName = onlineRoom.game === 'gomoku' ? '五子棋' : '你画我猜';
        let extra = '';
        if (onlineRoom.game === 'draw' && drawPhase === 'waiting') extra = ' · 房主点击「开始游戏」';
        if (onlineRoom.game === 'gomoku' && onlinePlayers.length < 2) extra = ' · 等待另一位玩家加入';
        statusEl.textContent = `${gameName} · 在线 ${onlineCount}/${onlinePlayers.length} 人${extra}`;
    }

    updateDrawControls();
}

// ---------- 五子棋联机 ----------
function gomokuResetLocal() {
    gomokuBoard = Array.from({ length: GOMOKU_SIZE }, () => new Array(GOMOKU_SIZE).fill(0));
    gomokuHistory = [];
    gomokuTurnSeat = 0;
    gomokuGameOver = false;
    gomokuWinnerSeat = -1;
    gomokuResultSaved = false;
}

function gomokuUpdateInfo() {
    const statusEl = document.getElementById('gomokuStatus');
    const stepsEl = document.getElementById('gomokuSteps');
    if (statusEl) {
        if (!onlineRoom || onlineRoom.game !== 'gomoku') {
            statusEl.textContent = '等待对手';
        } else if (onlinePlayers.length < 2) {
            statusEl.textContent = '等待对手加入（复制邀请链接发给对方）';
        } else if (gomokuGameOver) {
            statusEl.textContent = gomokuWinnerSeat >= 0 ? `${seatName(gomokuWinnerSeat)}获胜！` : '平局';
        } else {
            statusEl.textContent = onlineMySeat === gomokuTurnSeat ? '轮到你落子' : `等待${seatName(gomokuTurnSeat)}落子`;
        }
    }
    if (stepsEl) stepsEl.textContent = `${gomokuHistory.length} 手`;
}

function gomokuHandleClick(e) {
    if (!onlineRoom || onlineRoom.game !== 'gomoku') return;
    if (onlinePlayers.length < 2) { alert('等待另一位玩家加入后再落子'); return; }
    if (gomokuGameOver) return;
    if (onlineMySeat !== gomokuTurnSeat) return;

    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    if (!size) return;
    const margin = size * 0.045;
    const step = (size - margin * 2) / (GOMOKU_SIZE - 1);
    const col = Math.round((e.clientX - rect.left - margin) / step);
    const row = Math.round((e.clientY - rect.top - margin) / step);
    if (row < 0 || row >= GOMOKU_SIZE || col < 0 || col >= GOMOKU_SIZE) return;
    if (gomokuBoard[row][col] !== 0) return;

    roomSend('gomoku_move', { row, col, seat: onlineMySeat });
    applyGomokuMove(row, col, onlineMySeat);
}

function applyGomokuMove(row, col, seat) {
    if (!onlineRoom || onlineRoom.game !== 'gomoku') return;
    if (gomokuGameOver) return;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= GOMOKU_SIZE || col < 0 || col >= GOMOKU_SIZE) return;
    if (gomokuBoard[row][col] !== 0) return;
    if (seat !== gomokuTurnSeat) {
        requestGomokuState();
        return;
    }

    const player = seat + 1;
    gomokuBoard[row][col] = player;
    gomokuHistory.push({ row, col, player, seat });

    if (gomokuCheckWin(row, col, player)) {
        gomokuWinnerSeat = seat;
        gomokuGameOver = true;
    } else if (gomokuHistory.length >= GOMOKU_SIZE * GOMOKU_SIZE) {
        gomokuWinnerSeat = -1;
        gomokuGameOver = true;
    } else {
        gomokuTurnSeat = 1 - seat;
    }

    gomokuUpdateInfo();
    gomokuDraw();

    if (gomokuGameOver) saveGomokuResult();
}

function gomokuRestartOnline() {
    if (!onlineRoom || onlineRoom.game !== 'gomoku') return;
    if (onlinePlayers.length < 2) { alert('需要两名玩家才能开始'); return; }
    roomSend('gomoku_restart', { by: onlineMySeat });
    gomokuApplyRestart();
}

function gomokuApplyRestart() {
    gomokuResetLocal();
    gomokuUpdateInfo();
    gomokuDraw();
}

function gomokuUndoOnline() {
    if (!onlineRoom || onlineRoom.game !== 'gomoku') return;
    if (gomokuGameOver || gomokuHistory.length === 0) return;
    roomSend('gomoku_undo', {});
    gomokuApplyUndo();
}

function gomokuApplyUndo() {
    if (!gomokuHistory.length) return;
    const last = gomokuHistory.pop();
    gomokuBoard[last.row][last.col] = 0;
    gomokuTurnSeat = last.seat;
    gomokuGameOver = false;
    gomokuWinnerSeat = -1;
    gomokuResultSaved = false;
    gomokuUpdateInfo();
    gomokuDraw();
}

function requestGomokuState() {
    roomSend('gomoku_request_state', { from: currentUser ? currentUser.id : '' });
}

function sendGomokuState(requesterId) {
    if (!onlineRoom || onlineRoom.game !== 'gomoku') return;
    const candidates = onlinePlayers
        .filter(p => onlinePresenceUsers[p.user_id] && p.user_id !== requesterId)
        .sort((a, b) => a.seat - b.seat);
    if (!candidates.length || candidates[0].seat !== onlineMySeat) return;
    roomSend('gomoku_state', {
        board: gomokuBoard,
        history: gomokuHistory,
        turnSeat: gomokuTurnSeat,
        gameOver: gomokuGameOver,
        winnerSeat: gomokuWinnerSeat
    });
}

function applyGomokuState(state) {
    if (!state || !Array.isArray(state.board)) return;
    if (!(onlineRoom && onlineRoom.game === 'gomoku')) return;
    const incomingHistory = state.history || [];
    if (incomingHistory.length < gomokuHistory.length) return; // 不采纳更旧的快照
    gomokuBoard = state.board.map(row => row.slice());
    gomokuHistory = incomingHistory.map(m => ({ row: m.row, col: m.col, player: m.player, seat: m.seat }));
    gomokuTurnSeat = state.turnSeat === 1 ? 1 : 0;
    gomokuGameOver = !!state.gameOver;
    gomokuWinnerSeat = Number.isInteger(state.winnerSeat) ? state.winnerSeat : -1;
    gomokuUpdateInfo();
    gomokuDraw();
}

async function saveGomokuResult() {
    if (gomokuResultSaved || !onlineRoom || !currentUser) return;
    if (onlineMySeat !== 0) return; // 只由黑方写库，避免重复写入
    gomokuResultSaved = true;
    const winner = gomokuWinnerSeat >= 0 ? seatName(gomokuWinnerSeat) : '平局';
    try {
        await dbClient.from('game_rooms').update({
            status: 'finished',
            result: { winner, moves: gomokuHistory.length, finished_at: new Date().toISOString() }
        }).eq('id', onlineRoom.id);
    } catch (e) {
        console.warn('保存对局结果失败', e);
    }
}

// ---------- 你画我猜 ----------
function drawCanvasEl() {
    return document.getElementById('drawCanvas');
}

function drawResetLocal() {
    stopDrawTimer();
    if (drawNextRoundTimer) {
        clearTimeout(drawNextRoundTimer);
        drawNextRoundTimer = null;
    }
    drawPhase = 'waiting';
    drawRound = 0;
    drawTotalRounds = 0;
    drawDrawerSeat = -1;
    drawAnswer = '';
    drawWordLength = 0;
    drawScores = {};
    drawGuessedSeats = {};
    drawStrokes = [];
    drawStrokeMap.clear();
    drawWordChoices = [];
    drawPendingGuesses = {};
    drawPointerActive = false;
    drawCurrentId = null;
    drawStrokeBuffer = [];
    if (drawFlushTimer) { clearInterval(drawFlushTimer); drawFlushTimer = null; }

    hideDrawWordChoices();
    const chat = document.getElementById('drawChatList');
    if (chat) chat.innerHTML = '';
    drawRenderAll();
    drawUpdateTopbar();
    updateDrawControls();
}

function drawIsHost() {
    return !!(onlineRoom && currentUser && onlineRoom.host_id === currentUser.id);
}

function drawSeatList() {
    return onlinePlayers.map(p => p.seat).sort((a, b) => a - b);
}

function drawDrawerForRound(round) {
    const seats = drawSeatList();
    if (!seats.length) return -1;
    return seats[(round - 1) % seats.length];
}

function drawPickWords() {
    const pool = DRAW_WORDS.slice();
    const words = [];
    while (words.length < 3 && pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        words.push(pool.splice(idx, 1)[0]);
    }
    return words;
}

function drawStoredAnswerKey() {
    return `draw_answer_${onlineRoom ? onlineRoom.id : ''}`;
}

function storeDrawAnswer(round, answer) {
    try {
        localStorage.setItem(drawStoredAnswerKey(), JSON.stringify({ round, answer }));
    } catch (e) { /* ignore */ }
}

function readStoredDrawAnswer(round) {
    try {
        const raw = localStorage.getItem(drawStoredAnswerKey());
        if (!raw) return '';
        const saved = JSON.parse(raw);
        return (saved && saved.round === round) ? (saved.answer || '') : '';
    } catch (e) {
        return '';
    }
}

function startDrawGame() {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (!drawIsHost()) { alert('只有房主可以开始游戏'); return; }
    if (onlinePlayers.length < 2) { alert('至少需要 2 名玩家'); return; }
    const totalRounds = Math.min(onlinePlayers.length * 2, 16);
    roomSend('draw_game_start', { totalRounds });
    applyDrawGameStart(totalRounds);
    try {
        dbClient.from('game_rooms').update({ status: 'playing' }).eq('id', onlineRoom.id);
    } catch (e) { /* ignore */ }
}

function applyDrawGameStart(totalRounds) {
    drawTotalRounds = totalRounds || Math.min(onlinePlayers.length * 2, 16);
    drawRound = 0;
    drawScores = {};
    onlinePlayers.forEach(p => { drawScores[p.seat] = 0; });
    drawGuessedSeats = {};
    drawAnswer = '';
    drawWordLength = 0;
    drawPhase = 'waiting';
    const chat = document.getElementById('drawChatList');
    if (chat) chat.innerHTML = '';
    drawAddChat('游戏开始，共 ' + drawTotalRounds + ' 轮', 'draw-system');
    drawEnterChoosing(1);
    renderRoomPlayers();
}

function drawEnterChoosing(round) {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (round > drawTotalRounds) { drawShowGameEnd(); return; }

    drawPhase = 'choosing';
    drawRound = round;
    drawDrawerSeat = drawDrawerForRound(round);
    drawAnswer = '';
    drawWordLength = 0;
    drawGuessedSeats = {};
    drawStrokes = [];
    drawStrokeMap.clear();
    drawPendingGuesses = {};
    drawPointerActive = false;
    drawCurrentId = null;
    drawStrokeBuffer = [];
    drawRenderAll();
    stopDrawTimer();

    if (onlineMySeat === drawDrawerSeat) {
        drawWordChoices = drawPickWords();
        renderDrawWordChoices();
    } else {
        drawWordChoices = [];
        hideDrawWordChoices();
    }

    const drawer = playerBySeat(drawDrawerSeat);
    drawAddChat(`第 ${round}/${drawTotalRounds} 轮，绘画者：${drawer ? drawer.display_name : '—'}`, 'draw-system');
    drawUpdateTopbar();
    updateDrawControls();
    renderRoomPlayers();
}

function renderDrawWordChoices() {
    const box = document.getElementById('drawWordChoices');
    if (!box) return;
    box.innerHTML = '';
    box.style.display = 'flex';
    drawWordChoices.forEach(word => {
        const btn = document.createElement('button');
        btn.className = 'success';
        btn.textContent = word;
        btn.addEventListener('click', () => chooseDrawWord(word));
        box.appendChild(btn);
    });

    // 自定义题目：仅绘画者会走到这里，其他玩家调用的是 hideDrawWordChoices()
    const customWrap = document.createElement('div');
    customWrap.className = 'draw-custom-word';

    const customInput = document.createElement('input');
    customInput.id = 'drawCustomWordInput';
    customInput.type = 'text';
    customInput.placeholder = `或自定义题目（1-${DRAW_CUSTOM_WORD_MAX} 字）`;
    customInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            chooseCustomDrawWord(customInput);
        }
    });

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'primary-dark';
    customBtn.textContent = '用自定义题开始';
    customBtn.addEventListener('click', () => chooseCustomDrawWord(customInput));

    const customTip = document.createElement('span');
    customTip.className = 'draw-custom-tip';
    customTip.textContent = `最多 ${DRAW_CUSTOM_WORD_MAX} 个字`;

    customWrap.appendChild(customInput);
    customWrap.appendChild(customBtn);
    customWrap.appendChild(customTip);
    box.appendChild(customWrap);
}

function chooseCustomDrawWord(input) {
    if (drawPhase !== 'choosing' || onlineMySeat !== drawDrawerSeat) return;
    const raw = ((input && input.value) || '').trim();
    if (!raw) {
        alert('自定义题目不能为空，请输入内容后再开始');
        if (input) input.focus();
        return;
    }
    const word = raw.replace(/\s+/g, ' ');
    const len = Array.from(word).length;
    if (len > DRAW_CUSTOM_WORD_MAX) {
        alert(`自定义题目最多 ${DRAW_CUSTOM_WORD_MAX} 个字，当前 ${len} 个，请精简后再开始`);
        if (input) input.focus();
        return;
    }
    chooseDrawWord(word);
}

function hideDrawWordChoices() {
    const box = document.getElementById('drawWordChoices');
    if (!box) return;
    box.innerHTML = '';
    box.style.display = 'none';
}

function chooseDrawWord(word) {
    if (drawPhase !== 'choosing' || onlineMySeat !== drawDrawerSeat) return;
    const wordLength = Array.from(word).length;
    drawAnswer = word;
    drawWordLength = wordLength;
    storeDrawAnswer(drawRound, word);
    // 只广播字数，不广播答案；答案仅保存在绘画者本地（localStorage + 内存）
    roomSend('draw_round_go', {
        round: drawRound,
        drawerSeat: drawDrawerSeat,
        length: wordLength,
        durationMs: DRAW_ROUND_MS
    });
    beginDrawRound(true);
}

function beginDrawRound(isDrawer) {
    drawPhase = 'drawing';
    drawStrokes = [];
    drawStrokeMap.clear();
    drawPointerActive = false;
    drawCurrentId = null;
    drawStrokeBuffer = [];
    drawRenderAll();
    hideDrawWordChoices();
    if (isDrawer) drawAddChat('你来作画，请根据提示词画出内容', 'draw-system');
    startDrawTimer(DRAW_ROUND_MS);
    drawUpdateTopbar();
    updateDrawControls();
    renderRoomPlayers();
}

function applyDrawRoundGo(payload) {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (payload.round) drawRound = payload.round;
    if (payload.drawerSeat !== undefined) drawDrawerSeat = payload.drawerSeat;
    const isDrawer = onlineMySeat === drawDrawerSeat;
    drawWordLength = payload.length || 0;
    drawAnswer = isDrawer ? readStoredDrawAnswer(drawRound) : '';
    if (!drawAnswer) drawAnswer = '';
    drawPhase = 'drawing';
    drawStrokes = [];
    drawStrokeMap.clear();
    drawRenderAll();
    hideDrawWordChoices();
    drawAddChat(`本轮开始，答案共 ${drawWordLength} 个字`, 'draw-system');
    startDrawTimer(payload.durationMs || DRAW_ROUND_MS);
    drawUpdateTopbar();
    updateDrawControls();
    renderRoomPlayers();
}

function stopDrawTimer() {
    if (drawTimerId) {
        clearInterval(drawTimerId);
        drawTimerId = null;
    }
}

function startDrawTimer(durationMs) {
    stopDrawTimer();
    drawRoundEndsAt = Date.now() + Math.max(0, durationMs);
    drawUpdateTopbar();
    drawTimerId = setInterval(() => {
        drawUpdateTopbar();
        if (Date.now() >= drawRoundEndsAt && drawPhase === 'drawing') {
            stopDrawTimer();
            if (onlineMySeat === drawDrawerSeat) endDrawRound('timeout');
        }
    }, 500);
}

function drawUpdateTopbar() {
    const roundEl = document.getElementById('drawRoundText');
    const timerEl = document.getElementById('drawTimerText');
    const hintEl = document.getElementById('drawWordHint');

    if (roundEl) {
        if (!onlineRoom || onlineRoom.game !== 'draw' || drawPhase === 'waiting') {
            roundEl.textContent = '等待开始';
        } else if (drawPhase === 'ended') {
            roundEl.textContent = '游戏结束';
        } else if (drawPhase === 'choosing') {
            roundEl.textContent = `第 ${drawRound}/${drawTotalRounds} 轮 · 选题中`;
        } else if (drawPhase === 'reveal') {
            roundEl.textContent = `第 ${drawRound}/${drawTotalRounds} 轮 · 公布答案`;
        } else {
            roundEl.textContent = `第 ${drawRound}/${drawTotalRounds} 轮`;
        }
    }

    if (timerEl) {
        if (drawPhase === 'drawing') {
            const left = Math.max(0, Math.ceil((drawRoundEndsAt - Date.now()) / 1000));
            timerEl.textContent = `${left}s`;
        } else {
            timerEl.textContent = '--';
        }
    }

    if (hintEl) {
        if (drawPhase === 'drawing') {
            if (onlineMySeat === drawDrawerSeat) {
                hintEl.textContent = drawAnswer ? `你要画：${drawAnswer}` : '你要画：—';
            } else {
                hintEl.textContent = `答案：${'＿'.repeat(Math.max(0, drawWordLength))}`;
            }
        } else if (drawPhase === 'reveal' || drawPhase === 'ended') {
            hintEl.textContent = drawAnswer ? `答案：${drawAnswer}` : '—';
        } else {
            hintEl.textContent = '—';
        }
    }
}

function updateDrawControls() {
    const tools = document.getElementById('drawTools');
    const guessInput = document.getElementById('drawGuessInput');
    const startBtn = document.getElementById('drawStartBtn');
    const canvas = drawCanvasEl();
    const inDrawRoom = !!(onlineRoom && onlineRoom.game === 'draw');
    const canDraw = inDrawRoom && drawPhase === 'drawing' && onlineMySeat === drawDrawerSeat;

    if (tools) tools.style.display = canDraw ? 'flex' : 'none';
    if (guessInput) guessInput.disabled = !(inDrawRoom && drawPhase === 'drawing' && onlineMySeat !== drawDrawerSeat);
    if (startBtn) {
        const canStart = inDrawRoom && drawIsHost() && (drawPhase === 'waiting' || drawPhase === 'ended');
        startBtn.style.display = canStart ? 'inline-block' : 'none';
    }
    if (canvas) canvas.classList.toggle('readonly', !canDraw);
}

function endDrawRound(reason) {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (drawPhase !== 'drawing' || onlineMySeat !== drawDrawerSeat) return;
    const payload = {
        answer: drawAnswer || '—',
        scores: Object.assign({}, drawScores),
        round: drawRound,
        reason
    };
    roomSend('draw_round_end', payload);
    applyDrawRoundEnd(payload);
}

function applyDrawRoundEnd(payload) {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (drawPhase === 'reveal' || drawPhase === 'ended') return;

    stopDrawTimer();
    drawPhase = 'reveal';
    if (payload.scores) drawScores = payload.scores;
    if (payload.answer) drawAnswer = payload.answer;
    drawPendingGuesses = {};
    drawPointerActive = false;
    drawCurrentId = null;
    drawStrokeBuffer = [];

    drawAddChat(`本轮结束，答案：${payload.answer || '—'}`, 'draw-system');
    drawUpdateTopbar();
    updateDrawControls();
    renderRoomPlayers();

    if (drawNextRoundTimer) clearTimeout(drawNextRoundTimer);
    drawNextRoundTimer = setTimeout(() => {
        drawNextRoundTimer = null;
        if (!onlineRoom || onlineRoom.game !== 'draw') return;
        const nextRound = drawRound + 1;
        if (nextRound > drawTotalRounds) drawShowGameEnd();
        else drawEnterChoosing(nextRound);
    }, DRAW_REVEAL_MS);
}

function drawShowGameEnd() {
    drawPhase = 'ended';
    drawDrawerSeat = -1;
    stopDrawTimer();
    drawUpdateTopbar();
    updateDrawControls();
    const scoreText = drawSeatList()
        .map(seat => `${seatName(seat)} ${drawScores[seat] || 0} 分`)
        .join('，');
    drawAddChat(`游戏结束：${scoreText || '暂无得分'}`, 'draw-system');
    renderRoomPlayers();

    if (drawIsHost() && onlineRoom) {
        const result = {
            players: onlinePlayers.map(p => ({ name: p.display_name, score: drawScores[p.seat] || 0 })),
            rounds: drawTotalRounds,
            finished_at: new Date().toISOString()
        };
        dbClient.from('game_rooms').update({ status: 'finished', result }).eq('id', onlineRoom.id)
            .then(() => {})
            .catch(() => {});
    }
}

function drawAddChat(text, cls) {
    const list = document.getElementById('drawChatList');
    if (!list) return;
    const row = document.createElement('div');
    if (cls) row.className = cls;
    row.textContent = text;
    list.appendChild(row);
    while (list.children.length > 120) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
}

function sendDrawGuess() {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (drawPhase !== 'drawing') return;
    if (onlineMySeat === drawDrawerSeat) return;
    const input = document.getElementById('drawGuessInput');
    const text = ((input && input.value) || '').trim();
    if (!text) return;
    if (input) input.value = '';

    const id = genUuid();
    const len = Array.from(text).length;
    // 本地只给自己显示原话；广播出去的内容里不含原文
    drawAddChat(`${onlineMyName}：${text}`, 'draw-guess');
    drawPendingGuesses[id] = { text };
    // 是否答对由绘画者本地判定：频道里只传摘要与字数
    roomSend('draw_guess', {
        id,
        seat: onlineMySeat,
        name: onlineMyName,
        length: len,
        hash: drawGuessHash(text)
    });
}

function drawMaskText(len) {
    // 用等长星号替代猜对的原话
    return '*'.repeat(Math.max(1, Number(len) || 1));
}

function drawGuessHash(text) {
    const s = normalizeGuess(text);
    let a = 0x811c9dc5;
    let b = 5381;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        a = ((a ^ c) * 16777619) >>> 0;
        b = ((b << 5) + b + c) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function handleDrawGuess(payload) {
    if (!payload || !onlineRoom || onlineRoom.game !== 'draw') return;
    if (payload.seat === drawDrawerSeat) return;
    // 只有绘画者做判定，其他人只等结果
    if (onlineMySeat !== drawDrawerSeat || drawPhase !== 'drawing') return;
    if (!payload.id || drawGuessedSeats[payload.seat]) return;

    if (payload.hash === drawGuessHash(drawAnswer)) {
        drawGuessedSeats[payload.seat] = true;
        drawScores[payload.seat] = (drawScores[payload.seat] || 0) + 1;
        const okPayload = {
            id: payload.id,
            seat: payload.seat,
            name: payload.name,
            length: payload.length || 0,
            scores: Object.assign({}, drawScores)
        };
        roomSend('draw_guess_ok', okPayload);
        applyDrawGuessOk(okPayload);

        const guessers = onlinePlayers.filter(p => p.seat !== drawDrawerSeat).map(p => p.seat);
        if (guessers.length && guessers.every(seat => drawGuessedSeats[seat])) {
            endDrawRound('all');
        }
    } else {
        // 猜错：让猜词者自己把原话回显给其他人（猜对的原话永远不会被广播）
        roomSend('draw_guess_miss', { id: payload.id, seat: payload.seat });
    }
}

function applyDrawGuessMiss(payload) {
    if (!payload || !onlineRoom || onlineRoom.game !== 'draw') return;
    if (payload.seat !== onlineMySeat) return;
    const pending = drawPendingGuesses[payload.id];
    if (!pending) return;
    delete drawPendingGuesses[payload.id];
    roomSend('draw_guess_show', {
        id: payload.id,
        seat: onlineMySeat,
        name: onlineMyName,
        text: pending.text
    });
}

function applyDrawGuessShow(payload) {
    if (!payload || !onlineRoom || onlineRoom.game !== 'draw') return;
    if (payload.seat === onlineMySeat) return;
    drawAddChat(`${payload.name}：${payload.text}`, 'draw-guess');
}

function applyDrawGuessOk(payload) {
    if (!payload) return;
    if (payload.scores) drawScores = payload.scores;
    drawGuessedSeats[payload.seat] = true;
    delete drawPendingGuesses[payload.id];
    if (payload.seat === onlineMySeat) {
        // 猜对者本人能看到自己刚才输入的原话（上一条本地消息），这里只补一句结果
        drawAddChat('你猜对了', 'draw-ok');
    } else {
        drawAddChat(`${payload.name}：${drawMaskText(payload.length)}`, 'draw-guess');
        drawAddChat(`${payload.name} 猜对了`, 'draw-ok');
    }
    renderRoomPlayers();
}

function drawSkipRound() {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    if (drawPhase !== 'drawing' || onlineMySeat !== drawDrawerSeat) return;
    endDrawRound('skip');
}

function requestDrawState() {
    roomSend('draw_request_state', { from: currentUser ? currentUser.id : '' });
}

function sendDrawState(requesterId) {
    if (!onlineRoom || onlineRoom.game !== 'draw') return;
    const candidates = onlinePlayers
        .filter(p => onlinePresenceUsers[p.user_id] && p.user_id !== requesterId)
        .sort((a, b) => a.seat - b.seat);
    if (!candidates.length || candidates[0].seat !== onlineMySeat) return;
    roomSend('draw_state', {
        phase: drawPhase,
        round: drawRound,
        totalRounds: drawTotalRounds,
        drawerSeat: drawDrawerSeat,
        scores: Object.assign({}, drawScores),
        guessed: Object.assign({}, drawGuessedSeats),
        length: drawWordLength,
        answer: (drawPhase === 'reveal' || drawPhase === 'ended') ? drawAnswer : '',
        remainingMs: drawPhase === 'drawing' ? Math.max(0, drawRoundEndsAt - Date.now()) : 0
    });
}

function applyDrawState(state) {
    if (!state || !onlineRoom || onlineRoom.game !== 'draw') return;
    if (state.phase === 'waiting') return;
    const shouldApply = drawPhase === 'waiting' || drawPhase === 'ended' || state.round > drawRound;
    if (!shouldApply) return;

    drawPhase = state.phase;
    drawRound = state.round || 0;
    drawTotalRounds = state.totalRounds || drawTotalRounds;
    drawDrawerSeat = Number.isInteger(state.drawerSeat) ? state.drawerSeat : -1;
    drawScores = state.scores || {};
    drawGuessedSeats = state.guessed || {};
    drawWordLength = state.length || 0;
    if (state.phase === 'reveal' || state.phase === 'ended') drawAnswer = state.answer || '';
    if (state.phase === 'drawing' && onlineMySeat === drawDrawerSeat) {
        drawAnswer = readStoredDrawAnswer(drawRound) || drawAnswer;
    }

    if (state.phase === 'choosing' && onlineMySeat === drawDrawerSeat) {
        drawWordChoices = drawPickWords();
        renderDrawWordChoices();
    } else if (state.phase !== 'drawing') {
        hideDrawWordChoices();
    }

    drawAddChat(`已同步房间状态：第 ${drawRound}/${drawTotalRounds} 轮`, 'draw-system');
    if (state.phase === 'drawing') {
        startDrawTimer(state.remainingMs || 0);
    } else {
        stopDrawTimer();
    }
    if (state.phase === 'reveal') {
        if (drawNextRoundTimer) clearTimeout(drawNextRoundTimer);
        drawNextRoundTimer = setTimeout(() => {
            drawNextRoundTimer = null;
            if (!onlineRoom || onlineRoom.game !== 'draw') return;
            const nextRound = drawRound + 1;
            if (nextRound > drawTotalRounds) drawShowGameEnd();
            else drawEnterChoosing(nextRound);
        }, DRAW_REVEAL_MS);
    }
    drawUpdateTopbar();
    updateDrawControls();
    renderRoomPlayers();
}

// ---------- 画板绘制（本地 + 远端增量） ----------
function drawApplySegment(payload) {
    const canvas = drawCanvasEl();
    if (!canvas || !payload || !payload.id) return;
    const ctx = canvas.getContext('2d');
    let stroke = drawStrokeMap.get(payload.id);
    if (payload.start || !stroke) {
        stroke = {
            id: payload.id,
            color: payload.color || '#2c3e50',
            w: payload.w || 0.005,
            points: []
        };
        drawStrokes.push(stroke);
        drawStrokeMap.set(payload.id, stroke);
    }

    const W = canvas.width;
    const H = canvas.height;
    const pts = payload.points || [];
    if (!pts.length) return;

    const prevCount = stroke.points.length;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, (stroke.w || 0.005) * W);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (prevCount === 0 && pts.length === 1) {
        stroke.points.push(pts[0]);
        const x = pts[0].x * W;
        const y = pts[0].y * H;
        ctx.beginPath();
        ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        return;
    }

    if (prevCount === 0) {
        pts.forEach(p => stroke.points.push(p));
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
            const x = p.x * W;
            const y = p.y * H;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        return;
    }

    const last = stroke.points[prevCount - 1];
    ctx.beginPath();
    ctx.moveTo(last.x * W, last.y * H);
    pts.forEach(p => {
        stroke.points.push(p);
        const x = p.x * W;
        const y = p.y * H;
        ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function drawRenderAll() {
    const canvas = drawCanvasEl();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawStrokes.forEach(stroke => {
        if (!stroke || !stroke.points || !stroke.points.length) return;
        const W = canvas.width;
        const H = canvas.height;
        ctx.strokeStyle = stroke.color || '#2c3e50';
        ctx.lineWidth = Math.max(1, (stroke.w || 0.005) * W);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
            const x = p.x * W;
            const y = p.y * H;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        if (stroke.points.length === 1) {
            const p = stroke.points[0];
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = stroke.color || '#2c3e50';
            ctx.fill();
        } else {
            ctx.stroke();
        }
    });
}

function drawApplyUndo(payload) {
    if (!payload || !payload.id) return;
    drawStrokes = drawStrokes.filter(s => s.id !== payload.id);
    drawStrokeMap.delete(payload.id);
    drawRenderAll();
}

function drawCanDraw() {
    return !!(onlineRoom && onlineRoom.game === 'draw' && drawPhase === 'drawing' && onlineMySeat === drawDrawerSeat);
}

function drawEventPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function drawFlushBuffer() {
    if (!drawCurrentId || !drawStrokeBuffer.length) return;
    const points = drawStrokeBuffer.splice(0, drawStrokeBuffer.length);
    roomSend('draw_segment', { id: drawCurrentId, points });
}

function drawScheduleFlush() {
    if (drawFlushTimer) return;
    drawFlushTimer = setInterval(() => {
        if (!drawPointerActive) {
            clearInterval(drawFlushTimer);
            drawFlushTimer = null;
            return;
        }
        drawFlushBuffer();
    }, 50);
}

function onDrawPointerDown(e) {
    if (!drawCanDraw()) return;
    const canvas = drawCanvasEl();
    if (!canvas) return;
    const pos = drawEventPos(e, canvas);
    if (!pos) return;
    if (e.cancelable) e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    const colorInput = document.getElementById('drawColor');
    const sizeSelect = document.getElementById('drawSize');
    const color = (colorInput && colorInput.value) || '#2c3e50';
    const w = Number((sizeSelect && sizeSelect.value) || 4) / 800;

    drawCurrentId = `${onlineMySeat}-${Date.now()}-${drawStrokeSeq++}`;
    drawPointerActive = true;
    drawStrokeBuffer = [];
    drawScheduleFlush();

    const payload = { id: drawCurrentId, color, w, points: [pos], start: true };
    drawApplySegment(payload);
    roomSend('draw_segment', payload);
}

function onDrawPointerMove(e) {
    if (!drawPointerActive || !drawCurrentId) return;
    const canvas = drawCanvasEl();
    if (!canvas) return;
    const pos = drawEventPos(e, canvas);
    if (!pos) return;
    drawStrokeBuffer.push(pos);
    drawApplySegment({ id: drawCurrentId, points: [pos] });
}

function onDrawPointerUp() {
    if (!drawPointerActive) return;
    if (drawFlushTimer) {
        clearInterval(drawFlushTimer);
        drawFlushTimer = null;
    }
    drawFlushBuffer();
    if (drawCurrentId) {
        roomSend('draw_segment', { id: drawCurrentId, points: [] });
    }
    drawPointerActive = false;
    drawCurrentId = null;
    drawStrokeBuffer = [];
}

function drawUndoStroke() {
    if (!drawCanDraw()) return;
    drawFlushBuffer();
    const last = drawStrokes[drawStrokes.length - 1];
    if (!last) return;
    drawStrokes.pop();
    drawStrokeMap.delete(last.id);
    roomSend('draw_undo', { id: last.id });
    drawRenderAll();
}

function drawClearBoard() {
    if (!drawCanDraw()) return;
    drawFlushBuffer();
    drawStrokes = [];
    drawStrokeMap.clear();
    roomSend('draw_clear', {});
    drawRenderAll();
}

// ---------- 初始化 ----------
gomokuResetLocal();
drawResetLocal();

document.getElementById('gomokuCanvas').addEventListener('click', gomokuHandleClick);

(function bindDrawCanvas() {
    const canvas = document.getElementById('drawCanvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', onDrawPointerDown);
    canvas.addEventListener('pointermove', onDrawPointerMove);
    canvas.addEventListener('pointerup', onDrawPointerUp);
    canvas.addEventListener('pointercancel', onDrawPointerUp);
    canvas.addEventListener('pointerleave', onDrawPointerUp);
})();

window.addEventListener('resize', () => {
    const layer = document.getElementById('gameRoomLayer');
    if (layer && layer.style.display !== 'none' && onlineRoom && onlineRoom.game === 'gomoku') {
        gomokuDraw();
    }
});

// ========== 启动 ==========
window.addEventListener('load', initSupabase);
