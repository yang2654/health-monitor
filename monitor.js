const https = require('https');
const crypto = require('crypto');

const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;
const WX_OPENID = process.env.WX_OPENID;
const WX_TEMPLATE_TEMP = process.env.WX_TEMPLATE_TEMP;

async function getToken() {
    return new Promise(function(resolve) {
        https.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + WX_APPID + '&secret=' + WX_SECRET, { timeout: 10000 }, function(res) {
            var b = '';
            res.on('data', function(c) { b += c; });
            res.on('end', function() {
                try {
                    var d = JSON.parse(b);
                    console.log('token结果:', d.access_token ? '成功' : '失败-' + JSON.stringify(d));
                    resolve(d.access_token || null);
                } catch(e) { resolve(null); }
            });
        }).on('error', function(e) { console.log('token请求失败:', e.message); resolve(null); });
    });
}

async function main() {
    console.log('=== 测试开始 ===');
    
    var token = await getToken();
    if (!token) { console.log('❌ token失败'); return; }
    
    var now = new Date();
    var nowStr = now.getFullYear()+'年'+(now.getMonth()+1)+'月'+now.getDate()+'日 '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
    
    var body = JSON.stringify({
        touser: WX_OPENID,
        template_id: WX_TEMPLATE_TEMP,
        data: {
            first: { value: '👤 测试消息', color: '#173177' },
            keyword1: { value: '这是一条测试消息\n如果你收到，说明推送成功！', color: '#333333' },
            keyword2: { value: nowStr, color: '#999999' },
            remark: { value: '洋gg软件工作室', color: '#666666' }
        }
    });
    
    var u = new URL('https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=' + token);
    
    var req = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
    }, function(res) {
        var d = '';
        res.on('data', function(c) { d += c; });
        res.on('end', function() {
            console.log('发送结果:', d);
        });
    });
    req.on('error', function(e) { console.log('发送失败:', e.message); });
    req.end(body);
    
    console.log('=== 测试结束 ===');
}

main();
