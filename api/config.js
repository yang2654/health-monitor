var https = require('https');

// 从环境变量读取配置（更安全）
var CONFIG = {
    wxAppId: process.env.WX_APPID || '',
    wxSecret: process.env.WX_SECRET || '',
    templates: {
        temp: process.env.WX_TEMPLATE_TEMP || '',
        med: process.env.WX_TEMPLATE_MED || '',
        recovery: process.env.WX_TEMPLATE_RECOVERY || ''
    },
    intervals: { high: 30, mid: 45, low: 60, normal: 90 },
    recoveryDays: 3
};

// 简单内存存储（Vercel serverless实例存活期间有效）
if (!global._monitors) global._monitors = {};
if (!global._token) global._token = { value: '', expires: 0 };

// 获取微信access_token
function getToken() {
    return new Promise(function(resolve, reject) {
        var now = Date.now();
        if (global._token.value && now < global._token.expires) {
            resolve(global._token.value);
            return;
        }
        var url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + CONFIG.wxAppId + '&secret=' + CONFIG.wxSecret;
        https.get(url, function(res) {
            var data = '';
            res.on('data', function(c) { data += c; });
            res.on('end', function() {
                try {
                    var r = JSON.parse(data);
                    if (r.access_token) {
                        global._token = { value: r.access_token, expires: now + (r.expires_in - 300) * 1000 };
                        resolve(r.access_token);
                    } else {
                        reject('获取token失败: ' + data);
                    }
                } catch(e) { reject(e.message); }
            });
        }).on('error', function(e) { reject(e.message); });
    });
}

// 发送微信模板消息
function sendWxMsg(openId, templateId, data) {
    return new Promise(async function(resolve) {
        try {
            var token = await getToken();
            var body = JSON.stringify({ touser: openId, template_id: templateId, data: data });
            var u = new URL('https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=' + token);
            
            var req = https.request({
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, function(res) {
                var d = '';
                res.on('data', function(c) { d += c; });
                res.on('end', function() {
                    var r = JSON.parse(d);
                    console.log('微信消息:', r.errcode === 0 ? '✅成功' : '❌' + r.errmsg);
                    resolve(r.errcode === 0);
                });
            });
            req.on('error', function(e) { console.log('请求失败:', e.message); resolve(false); });
            req.write(body);
            req.end();
        } catch(e) { console.log('发送失败:', e); resolve(false); }
    });
}

// 判断体温等级
function getLevel(t) {
    if (t >= 39) return 'high';
    if (t >= 38) return 'mid';
    if (t >= 37.3) return 'low';
    return 'normal';
}

function levelText(l) {
    var m = { high: '高烧≥39°C', mid: '中度发热38-39°C', low: '低烧37.3-38°C', normal: '正常' };
    return m[l] || '';
}

function remindText(l) {
    var m = { high: '请立即测量体温！持续高热请就医！', mid: '请测量体温，观察症状变化', low: '请测量体温，多喝水多休息', normal: '请测量体温' };
    return m[l] || '';
}

function nowStr() {
    var n = new Date();
    function p(v) { return String(v).padStart(2, '0'); }
    return n.getFullYear() + '-' + p(n.getMonth()+1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes());
}

// 主函数
module.exports = async function(req, res) {
    // 设置CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    // 只处理POST请求
    if (req.method !== 'POST') {
        res.status(405).json({ error: '只支持POST请求' });
        return;
    }
    
    // 解析body
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
        try {
            var data = JSON.parse(body);
        } catch(e) {
            res.status(400).json({ error: 'JSON格式错误' });
            return;
        }
        
        var userId = data.userId;
        var temp = parseFloat(data.temperature);
        var childName = data.childName || '用户';
        
        if (!userId) {
            res.status(400).json({ error: '缺少userId参数' });
            return;
        }
        
        if (isNaN(temp) || temp < 35 || temp > 43) {
            res.status(400).json({ error: '体温数值无效，范围35-43°C' });
            return;
        }
        
        // 体温正常，不启动监测
        if (temp < 37.3) {
            res.json({ success: true, message: '体温正常，未启动监测', temperature: temp });
            return;
        }
        
        // 启动监测
        var level = getLevel(temp);
        global._monitors[userId] = {
            userId: userId,
            childName: childName,
            temperature: temp,
            level: level,
            interval: CONFIG.intervals[level],
            lastTempTime: data.tempTime || new Date().toISOString(),
            startTime: new Date().toISOString(),
            medRecords: data.medRecords || []
        };
        
        // 发送首次提醒
        await sendWxMsg(userId, CONFIG.templates.temp, {
            first: { value: '🔥 体温监测提醒', color: '#FF6B6B' },
            keyword1: { value: levelText(level) + '（' + temp + '°C）', color: '#333333' },
            keyword2: { value: remindText(level), color: '#E74C3C' },
            keyword3: { value: nowStr(), color: '#666666' },
            remark: { value: '监测对象：' + childName + '\n提醒间隔：每' + CONFIG.intervals[level] + '分钟', color: '#999999' }
        });
        
        console.log('监测已启动: ' + userId + ' ' + temp + '°C');
        
        res.json({
            success: true,
            message: '监测已启动',
            level: levelText(level),
            temperature: temp,
            interval: CONFIG.intervals[level],
            userId: userId
        });
    });
};
