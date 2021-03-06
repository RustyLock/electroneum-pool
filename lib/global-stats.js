/**
 * Saving pool and network statistics for a long period of time
 * @module global-stats
 */

var async = require('async');

var logSystem = 'api';

var statsPoint = 5; // 5 minutes
var lastSaveTime = 0;
var lastBlockTimestamp = 0;
var blockTime = 0;

var keyNet = config.coin + ':stats:networkDiff', 
    keyReward = config.coin + ':stats:blockReward',
    keyBlockTime = config.coin + ':stats:blockTimings',
    keyPoolSpeed = config.coin + ':stats:poolHashrate',
    keyPoolMiners = config.coin + ':stats:poolMiners';

function saveGlobalStats(data) {

    if(lastBlockTimestamp === 0) {
        lastBlockTimestamp = data.network.timestamp;
    }

    if(data.network.timestamp > lastBlockTimestamp) {
        var newBlockTime = data.network.timestamp - lastBlockTimestamp;
        blockTime = blockTime ? Math.floor(newBlockTime + blockTime) / 2 : newBlockTime;
        lastBlockTimestamp = data.network.timestamp;
    }

    var timeStamp = new Date();
    timeStamp.setMinutes(Math.floor(timeStamp.getMinutes() / statsPoint) * statsPoint, 0, 0);
    timeStamp = Math.floor(timeStamp.getTime() / 1000);
    if(timeStamp === lastSaveTime && lastSaveTime) {
        return;
    }

    var redisCommands = [
        ['zadd', keyNet, timeStamp, timeStamp + ':' + data.network.difficulty],
        ['zadd', keyReward, timeStamp, timeStamp + ':' + data.network.reward],
        ['zadd', keyPoolSpeed, timeStamp, timeStamp + ':' + Math.floor(data.pool.hashrate)],
        ['zadd', keyPoolMiners, timeStamp, timeStamp + ':' + data.pool.miners]
    ];

    if(blockTime > 0) {
        redisCommands.push(['zadd', keyBlockTime, timeStamp, timeStamp + ':' + blockTime]);
    }
    
    lastSaveTime = timeStamp;
    redisClient.multi(redisCommands).exec(function(error, replies) {
        if(error) {
            log('error', logSystem, 'Failed to save global stats: %s', [error.toString()]);
            return;
        }
        log('info', logSystem, 'Saved global stats as of %s', [new Date(timeStamp * 1000)]);
    });
}

function getHistoryMeasure(redisKey, name, from, to, type, cb) {
    
    var key = name + ':' + from + ':' + to,
        data = [], actualFromTo = [0, 0];

    cache.get(key, function(err, value) {
        if(err){
          log('error', logSystem, 'Failed to get cache item %s: %s', [key, err.toString()]);
          return;
        }
        if(value) {
            cb(value.data, value.period);
            return;
        }

        redisClient.zrevrangebyscore(redisKey, to, from, 'LIMIT', 0, 10000, function(error, results) {
            if(error) {
                log('error', logSystem, 'Failed to get global stats for %s: %s', [redisKey, error.toString()]);
                return;
            }
            results.forEach(function(itm) {
                var vals = itm.split(':'),
                    val = vals[vals.length-1];
                switch(type) {
                    case 'int':
                        val = parseInt(val);
                        break;
                    case 'flt':
                        val = parseFloat(val);
                        break;
                }
                if(actualFromTo[1] === 0) {
                    actualFromTo[1] = parseInt(vals[0]);
                }
                if(data.length === results.length - 1) {
                    actualFromTo[0] = parseInt(vals[0]);
                }                
                data.unshift(val);
            });
            cache.set(key, {data: data, period: actualFromTo}, 300, function(error, res) {
                if(error) {
                    log('error', logSystem, 'Failed to set local cache: %s', [error.toString()]);
                    return;
                }
                cb(data, actualFromTo);
            });
        });
    });
}

function getHistory(historyFrom, historyTo, poolHistoryFrom, poolHistoryTo, cb) {
    var ret = {}, from, to, poolFrom, poolTo;

    // make 'to' date inclusive by moving it to the last miliseond of the day
    function makePeriodEndInclusive(dt) {
        if(dt.getHours() === 0 && dt.getMinutes() === 0 && 
            dt.getSeconds() === 0 && dt.getMilliseconds() === 0) {
            return new Date(dt.getTime() + 86399999);
        }
        return dt;
    }
    
    if(historyFrom) {
        ret.historyFrom = new Date(historyFrom);
        from = Math.floor(ret.historyFrom.getTime() / 1000);
    }
    if(historyTo) {
        ret.historyTo = makePeriodEndInclusive(new Date(historyTo));
        to = Math.floor(ret.historyTo.getTime() / 1000);
    }
    if(poolHistoryFrom) {
        ret.poolHistoryFrom = new Date(poolHistoryFrom);
        poolFrom = Math.floor(ret.poolHistoryFrom.getTime() / 1000);
    }
    if(poolHistoryTo) {
        ret.poolHistoryTo = makePeriodEndInclusive(new Date(poolHistoryTo));
        poolTo = Math.floor(ret.poolHistoryTo.getTime() / 1000);
    }
    
    async.parallel([
        function(cb) {
            if(from && to) {
                getHistoryMeasure(keyNet, 'networkDiff', from, to, 'int', function(data, actualFromTo) {
                    ret.networkDiff = data;
                    ret.historyFrom = new Date(actualFromTo[0] * 1000);
                    ret.historyTo = new Date(actualFromTo[1] * 1000);
                    cb(null, ret);
                });
            } else  {
                cb(null, ret);
            }
        },
        function(cb) {
            if(from && to) {
                getHistoryMeasure(keyReward, 'blockReward', from, to, 'int', function(data) {
                    ret.blockReward = data;
                    cb(null, ret);
                });            
            } else {
                cb(null, ret);
            }
        },
        function(cb) {
            if(from && to) {
                getHistoryMeasure(keyBlockTime, 'blockTimings', from, to, 'flt', function(data) {
                    ret.blockTimings = data;
                    cb(null, ret);
                });            
            } else {
                cb(null, ret);
            }
        },
        function(cb) {
            if(poolFrom && poolTo) {
                getHistoryMeasure(keyPoolSpeed, 'poolHashrate', poolFrom, poolTo, 'int', function(data, actualFromTo) {
                    ret.poolHashrate = data;
                    ret.poolHistoryFrom = new Date(actualFromTo[0] * 1000);
                    ret.poolHistoryTo = new Date(actualFromTo[1] * 1000);                    
                    cb(null, ret);
                });            
            } else {
                cb(null, ret);
            }
        },
        function(cb) {
            if(poolFrom && poolTo) {
                getHistoryMeasure(keyPoolMiners, 'poolMiners', poolFrom, poolTo, 'int', function(data) {
                    ret.poolMiners = data;
                    cb(null, ret);
                });            
            } else {
                cb(null, ret);
            }
        }
    ], function(err, results) {
        if(err) {
            log('error', 'Failed to collect global stats: %s', [err.toString()]);
            return;
        }
        cb(ret);
    });
}

exports.saveGlobalStats = saveGlobalStats;
exports.getHistory = getHistory;