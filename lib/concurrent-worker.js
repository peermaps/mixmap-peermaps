var through = require('through2-concurrent')
var work = require('webworkify')

module.exports = ConcurrentWorker

function noop () {}

var STATUS = {
  BUSY: 0,
  FREE: 1,
}

function ConcurrentWorker (workerFn, options) {
  if (!(this instanceof ConcurrentWorker)) return new ConcurrentWorker(workerFn, options)
  var self = this

  if (!options) options = {}

  this._count = options.count || 4
  this._itemId = options.itemId,
  this._onItem = options.onItem || noop
  this._onFinish = options.onFinish || noop

  this._workers = []
  
  for (var i = 0; i < this._count; i++) {
    this._workers[i] = {
      worker: work(workerFn),
      status: STATUS.FREE,
    }
  }

  this.freeWorker = function () {
    const w = self._workers.find(w => w.status === STATUS.FREE)
    if (!w) throw new Error('No free workers')
    return w
  }

  return through.obj({
      maxConcurrency: this._count,
    },
    function (row, _, next) {
      // row : { queryIndex, buffer, rowCount }
      var w = self.freeWorker()

      // msg : { queryIndex, buffer, rowCount, decoded }
      function messageHandler (e) {
        var msg = e.data
        if (self._itemId(row) === self._itemId(msg)) {
          self._onItem(msg)
          w.worker.removeEventListener('message', messageHandler)
          w.status = STATUS.FREE
          next()
        }
      }
      Object.defineProperty(messageHandler, 'name', {
        value: `messageHandler-${self._itemId(row)}`,
        writable: false,
      })
      w.worker.addEventListener('message', messageHandler)

      w.status = STATUS.BUSY
      // console.log({crossOriginIsolated: window.crossOriginIsolated})
      // we are returning false :(
      // we are loading the app from one server, and then getting data
      // from another location, so i don't think this is possible atm
      // if (window.crossOriginIsolated) {
      //   w.worker.postMessage({
      //     queryIndex: row.queryIndex,
      //     rowCount: row.rowCount,
      //     buffer: new SharedArrayBuffer(row.buffer),
      //   })
      // }
      // else {
      //   w.worker.postMessage(row)  
      // }
      w.worker.postMessage(row)
    },
    this._onFinish)
}
