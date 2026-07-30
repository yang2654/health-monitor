if (!global._monitors) global._monitors = {};

module.exports = function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    var list = [];
    for (var k in global._monitors) {
        var m = global._monitors[k];
        list.push({
            userId: k,
            childName: m.childName,
            temperature: m.temperature,
            level: m.level,
            interval: m.interval,
            startTime: m.startTime,
            lastCheck: m.lastTempTime
        });
    }
    res.json({ total: list.length, monitors: list, serverTime: new Date().toISOString() });
};
