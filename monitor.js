const https = require('https');
const crypto = require('crypto');

const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;
const WX_OPENID = process.env.WX_OPENID;
const WX_TEMPLATE_TEMP = process.env.WX_TEMPLATE_TEMP;
const WX_TEMPLATE_MED = process.env.WX_TEMPLATE_MED;
const WX_TEMPLATE_RECOVERY = process.env.WX_TEMPLATE_RECOVERY;
const OSS_KEY = process.env.OSS_KEY;
const OSS_SECRET = process.env.OSS_SECRET;
const OSS_BUCKET = process.env.OSS_BUCKET;
const OSS_HOST = process.env.OSS_HOST;

const TEMP_INTERVALS = { high: 30, mid: 45, low: 60, normal: 90 };
const FEVER_LINE = 37.3;
const RECOVERY_DAYS = 3;

function ossGet(path) {
    return new Promise(function(resolve) {
        var date = new Date().toUTCString();
        var s = 'GET\n\n\n' + date + '\n/' + OSS_BUCKET + path;
        var sig = crypto.createHmac('sha1', OSS_SECRET).update(s).digest('base64');
        https.get({
            hostname: OSS_HOST, path: path, timeout: 10000,
            headers: { Date: date, Authorization: 'OSS ' + OSS_KEY + ':' + sig }
        }, function(res) {
            var d = '';
            res.on('data', function(c) { d += c; });
            res.on('end', function() {
                try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
            });
        }).on('error', function() { resolve(null); });
    });
}

function ossPut(path, data) {
    return new Promise(function(resolve) {
        var date = new Date().toUTCString();
        var body = JSON.stringify(data);
        var s = 'PUT\n\napplication/json\n' + date + '\n/' + OSS_BUCKET + path;
        var sig = crypto.createHmac('sha1', OSS_SECRET).update(s).digest('base64');
        var req = https.request({
            hostname: OSS_HOST, path: path, method: 'PUT', timeout: 10000,
            headers: { Date: date, Authorization: 'OSS ' + OSS_KEY + ':' + sig, 'Content-Type': 'application/json' }
        }, function(res) { res.on('end', function() { console.log('OSS保存完成'); resolve(); }); });
        req.on('error', function(e) { console.log('OSS保存失败:', e.message); resolve(); });
        req.end(body);
    });
}

async function getToken() {
    var cached = await ossGet('/wx_token.json');
    if (cached && cached.token && cached.expires > Date.now() + 300000) {
        console.log('使用缓存token');
        return cached.token;
    }
    
    console.log('请求新token...');
    var d = await new Promise(function(resolve) {
        https.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + WX_APPID + '&secret=' + WX_SECRET, { timeout: 10000 }, function(res) {
            var b = '';
            res.on('data', function(c) { b += c; });
            res.on('end', function() {
                try { resolve(JSON.parse(b)); } catch(e) { resolve(null); }
            });
        }).on('error', function(e) { console.log('token请求失败:', e.message); resolve(null); });
    });
    
    if (d && d.access_token) {
        console.log('token获取成功，保存缓存');
        await ossPut('/wx_token.json', { token: d.access_token, expires: Date.now() + 5400000 });
        return d.access_token;
    }
    console.log('token获取失败:', JSON.stringify(d));
    return null;
}

function sendWx(token, templateId, data) {
    return new Promise(function(resolve) {
        var body = JSON.stringify({ touser: WX_OPENID, template_id: templateId, data: data });
        var u = new URL('https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=' + token);
        var req = https.request({
            hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        }, function(res) {
            var d = '';
            res.on('data', function(c) { d += c; });
            res.on('end', function() {
                try {
                    var r = JSON.parse(d);
                    console.log(r.errcode === 0 ? '✅发送成功' : '❌失败:' + r.errmsg);
                    resolve(r.errcode === 0);
                } catch(e) { console.log('解析发送结果失败'); resolve(false); }
            });
        });
        req.on('error', function(e) { console.log('发送请求失败:', e.message); resolve(false); });
        req.end(body);
    });
}

function getLevel(t) {
    if (t >= 39) return 'high';
    if (t >= 38) return 'mid';
    if (t >= 37.3) return 'low';
    return 'normal';
}

var levelText = { high: '🔴高热', mid: '🟠中度', low: '🟡低烧', normal: '🟢正常' };
var remindText = { high: '请立即测量！持续高热请就医！', mid: '请测量体温，观察症状', low: '请测量体温，多休息', normal: '请测量体温' };

function fmtTime(iso) {
    var d = new Date(iso);
    var p = function(v) { return String(v).padStart(2, '0'); };
    return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 '+p(d.getHours())+':'+p(d.getMinutes());
}

function ago(now, past) {
    var diff = now - past;
    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return d + '天' + h + '小时前';
    if (h > 0) return h + '小时' + m + '分钟前';
    if (m > 0) return m + '分钟前';
    return '刚刚';
}

async function main() {
    console.log('=== 健康监测 ===');
    
    var data = await ossGet('/baby_temp_data.json');
    if (!data) { console.log('❌ 读取数据失败'); return; }
    console.log('✅ 读取成功，成员数：' + Object.keys(data).length);
if (data['杨辰汐']) data['杨辰汐'].lastTempRemind = '2026-07-29T00:00:00.000Z';
    if (data['杨洋']) data['杨洋'].lastTempRemind = '2026-07-29T00:00:00.000Z';
    
    var now = new Date();
    var nowStr = now.getFullYear()+'年'+(now.getMonth()+1)+'月'+now.getDate()+'日 '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
    var msgs = [];
    var changed = false;
    var activeCount = 0;

    var names = Object.keys(data);
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var d = data[name];
        d.tempRecords = d.tempRecords || [];
        d.medRecords = d.medRecords || [];
        d.monitorStatus = d.monitorStatus || 'inactive';
        d.lastFeverDate = d.lastFeverDate || null;
        d.lastTempRemind = d.lastTempRemind || null;
        d.feverNotified = d.feverNotified || false;
        d.lastMedReminds = d.lastMedReminds || {};
        
        var temps = d.tempRecords;
        var meds = d.medRecords;

        var recentFever = temps.some(function(r) {
            return new Date(r.time) >= new Date(now - 3*86400000) && r.temperature >= FEVER_LINE;
        });

        // 启动监测
        if (d.monitorStatus === 'inactive' && recentFever && !d.feverNotified) {
            d.monitorStatus = 'active';
            d.lastFeverDate = now.toISOString().split('T')[0];
            d.feverNotified = true;
            d.lastTempRemind = null;
            changed = true;
            var last = temps[temps.length-1];
            var lv = getLevel(last.temperature);
            msgs.push({
                tid: WX_TEMPLATE_TEMP,
                data: {
                    first: { value: '👤 ' + name, color: '#173177' },
                    keyword1: { value: '🔔 检测到发热！监测已启动\n体温：' + last.temperature.toFixed(1) + '°C（' + levelText[lv] + '）\n时间：' + fmtTime(last.time) + '\n间隔：每' + TEMP_INTERVALS[lv] + '分钟', color: '#333333' },
                    keyword2: { value: nowStr, color: '#999999' },
                    remark: { value: '洋gg软件工作室', color: '#666666' }
                }
            });
            console.log(name + '：启动监测');
        }

        // 康复判断
        if (d.monitorStatus === 'active' && !recentFever && d.lastFeverDate) {
            var days = Math.floor((now - new Date(d.lastFeverDate)) / 86400000);
            if (days >= RECOVERY_DAYS) {
                d.monitorStatus = 'inactive';
                d.lastFeverDate = null;
                d.feverNotified = false;
                d.lastTempRemind = null;
                d.lastMedReminds = {};
                changed = true;
                msgs.push({
                    tid: WX_TEMPLATE_RECOVERY,
                    data: {
                        first: { value: '👤 ' + name, color: '#173177' },
                        keyword1: { value: '✅ 已连续' + days + '天体温正常\n监测已自动关闭', color: '#333333' },
                        keyword2: { value: nowStr, color: '#999999' },
                        remark: { value: '如有不适请重新记录体温', color: '#666666' }
                    }
                });
                console.log(name + '：康复，监测停止');
            }
        }

        // 体温提醒
        if (d.monitorStatus === 'active') {
            activeCount++;
            var lr = d.lastTempRemind ? new Date(d.lastTempRemind) : null;
            var last = temps[temps.length-1];
            if (last) {
                var lv = getLevel(last.temperature);
                var iv = TEMP_INTERVALS[lv] * 60 * 1000;
                if (!lr || (now - lr) > iv) {
                    d.lastTempRemind = now.toISOString();
                    changed = true;
                    msgs.push({
                        tid: WX_TEMPLATE_TEMP,
                        data: {
                            first: { value: '👤 ' + name, color: '#173177' },
                            keyword1: { value: '🌡️ ' + remindText[lv] + '\n体温：' + last.temperature.toFixed(1) + '°C（' + levelText[lv] + '）\n上次：' + ago(now, new Date(last.time)) + '\n间隔：每' + TEMP_INTERVALS[lv] + '分钟', color: '#333333' },
                            keyword2: { value: nowStr, color: '#999999' },
                            remark: { value: '请及时测量并记录', color: '#666666' }
                        }
                    });
                    console.log(name + '：发送体温提醒');
                }
            }

            // 用药提醒
            for (var j = 0; j < meds.length; j++) {
                var r = meds[j];
                if (r.intervalHours > 0) {
                    var dose = new Date(r.time).getTime();
                    var medIv = r.intervalHours * 3600000;
                    var nd = dose;
                    while (nd <= now.getTime()) nd += medIv;
                    if (Math.abs(now.getTime() - nd) < 5*60000) {
                        var key = r.id + '_' + Math.floor(nd / 60000);
                        if (!d.lastMedReminds[key]) {
                            d.lastMedReminds[key] = true;
                            changed = true;
                            msgs.push({
                                tid: WX_TEMPLATE_MED,
                                data: {
                                    first: { value: '👤 ' + name, color: '#173177' },
                                    keyword1: { value: '💊 该吃' + r.medicineName + '了！\n剂量：' + r.dosage + '\n间隔：每' + r.intervalHours + '小时\n上次：' + fmtTime(r.time), color: '#333333' },
                                    keyword2: { value: nowStr, color: '#999999' },
                                    remark: { value: '请按时服药', color: '#666666' }
                                }
                            });
                            console.log(name + '：用药提醒 - ' + r.medicineName);
                        }
                    }
                }
            }
        }
    }

    if (changed) {
        console.log('保存数据到OSS...');
        await ossPut('/baby_temp_data.json', data);
        console.log('保存完成');
    }

    if (msgs.length > 0) {
        console.log('准备发送 ' + msgs.length + ' 条消息');
        console.log('获取token...');
        var token = await getToken();
        console.log('token: ' + (token ? '成功' : '失败'));
        if (token) {
            for (var k = 0; k < msgs.length; k++) {
                console.log('发送第' + (k+1) + '条...');
                await sendWx(token, msgs[k].tid, msgs[k].data);
                console.log('第' + (k+1) + '条完成');
            }
        }
    } else {
        console.log('无消息，活跃监测：' + activeCount);
    }

    console.log('=== 完成 ===');
}

main();
