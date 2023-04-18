var {EventEmitter} = require('events')
var work = require('webworkify')
var decodeWorkFn = require('./feature-decode-worker')

module.exports = ConcurrentDecoder

function noop () {}

var STATUS = {
  BUSY: 0,
  FREE: 1,
}

function ConcurrentDecoder (options) {
  if (!(this instanceof ConcurrentDecoder)) return new ConcurrentDecoder(options)
  var self = this

  if (!options) options = {}

  var queue = []

  this._count = options.count || 4
  this._itemId = options.itemId

  this._workers = []

  var workerOnMessage = (i) => (e) => {
    self._workers[i].status = STATUS.FREE
    var row = e.data
    // row : { queryIndex, rowCount, buffer, decoded } 
    self.emit('decoded', row)
    tryShiftQueue()
  }
  
  for (var i = 0; i < this._count; i++) {
    var worker = work(decodeWorkFn)
    worker.onmessage = workerOnMessage(i)
    this._workers[i] = {
      worker,
      status: STATUS.FREE,
    }
  }

  function tryShiftQueue () {
    var row = queue.shift()
    if (!row) return
    self.emit('decode', row)
  }

  this.freeWorker = function () {
    return self._workers.find(w => w.status === STATUS.FREE)
  }

  this.on('decode', function (row) {
    // row { queryIndex, rowCount, buffer }
    var w = self.freeWorker()
    if (!w) {
      queue.push(row)
      return
    }
    w.status = STATUS.BUSY
    w.worker.postMessage(row)
  })

  this.on('terminate', function () {
    for (var i = 0; i < self._count; i++) {
      self._workers[i].worker.terminate()
    }
    self.emit('terminated')
  })
}

ConcurrentDecoder.prototype = Object.create(EventEmitter.prototype)
