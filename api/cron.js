var https = require('https');

var CONFIG = {
    wxAppId: process.env.WX_APPID || '',
    wxSecret: process.env.WX_SECRET || '',
    templates: {
        temp: process.env.WX_TEMPLATE_TEMP || '',
        recovery: process.env.WX_TEMPLATE_RECOVERY || ''
    },
    intervals: { high: 30, mid: 45, low: 60, normal: 90 },
    recoveryDays: 3
};

if (!global._monitors) global._monitors = {};
if (!global._token) global._token = { value: '', expires: 0 };

function getToken() {
    return new Promise(function(resolve, reject) {
        var now = Date.now();
        if (global._token.value && now < global._token.expires) { resolve(global._token.value); return; }
        var url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + CONFIG.wxAppId + '&secret=' + CONFIG.wxSecret;
        https.get(url, function(res) {
            var data = '';
            res.on('data', function(c) { data += c; });
            res.on('end', function() {
                var r = JSON.parse(data);
                if (r.access_token) {
                    global._token = { value: r.access_token, expires: now + (r.expires_in - 300) * 1000 };
                    resolve(r.access_token);
                } else { reject('token失败'); }
            });
        }).on('error', reject);
    });
}

function sendWxMsg(openId, templateId, data) {
    return new Promise(async function(resolve) {
        try {
            var token = await getToken();
            var body = JSON.stringify({ touser: openId, template_id: templateId, data: data });
            var u = new URL('https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=' + token);
            var req = https.request({
                hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            }, function(res) {
                var d = '';
                res.on('data', function(c) { d += c; });
                res.on('end', function() { resolve(JSON.parse(d).errcode === 0); });
            });
            req.on('error', function() { resolve(false); });
            req.write(body); req.end();
        } catch(e) { resolve(false); }
    });
}

function levelText(l) {
    var m = { high: '高烧', mid: '中度发热', low: '低烧', normal: '正常' };
    return m[l] || '';
}

function nowStr() {
    var n = new Date();
    function p(v) { return String(v).padStart(2, '0'); }
    return n.getFullYear() + '-' + p(n.getMonth()+1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes());
}

module.exports = async function(req, res) {
    var ids = Object.keys(global._monitors);
    console.log('定时检查: ' + ids.length + '个监测');
    
    var results = [];
    var now = new Date();
    
    for (var i = 0; i < ids.length; i++) {
        var userId = ids[i];
        var state = global._monitors[userId];
        var minutes = (now - new Date(state.lastTempTime)) / 60000;
        var days = minutes / 1440;
        
        if (days >= CONFIG.recoveryDays) {
            await sendWxMsg(userId, CONFIG.templates.recovery, {
                first: { value: '✅ 康复通知' },
                keyword1: { value: state.childName },
                keyword2: { value: '超过' + CONFIG.recoveryDays + '天无发烧' },
                keyword3: { value: '监测自动停止' },
                remark: { value: '恭喜康复！' }
            });
            delete global._monitors[userId];
            results.push({ userId: userId, recovered: true });
        } else if (minutes >= state.interval) {
            await sendWxMsg(userId, CONFIG.templates.temp, {
                first: { value: '🔥 体温监测提醒' },
                keyword1: { value: levelText(state.level) + '（上次' + state.temperature + '°C）' },
                keyword2: { value: '请及时测量体温并记录' },
                keyword3: { value: nowStr() },
                remark: { value: '监测对象：' + state.childName + '\n提醒间隔：每' + state.interval + '分钟' }
            });
            state.lastTempTime = now.toISOString();
            results.push({ userId: userId, tempReminder: true });
        } else {
            results.push({ userId: userId, checked: true, minutes: Math.floor(minutes) });
        }
    }
    
    res.json({ success: true, processed: ids.length, results: results, time: now.toISOString() });
};
