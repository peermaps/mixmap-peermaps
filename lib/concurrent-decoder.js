var through = require('through2-concurrent')
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

  this._count = options.count || 4
  this._itemId = options.itemId

  this._workers = []
  
  for (var i = 0; i < this._count; i++) {
    this._workers[i] = {
      worker: work(decodeWorkFn),
      status: STATUS.FREE,
    }
  }

  this.freeWorker = function () {
    const w = self._workers.find(w => w.status === STATUS.FREE)
    // error state should never be entered, we should always
    // have a free worker due to through2-concurrencty managing
    // when we get our next `row`
    if (!w) throw new Error('No free workers')
    return w
  }

  return function ({onItem=noop}={}) {
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
            onItem(msg)
            w.worker.removeEventListener('message', messageHandler)
            w.status = STATUS.FREE
            next()
          }
        }
        Object.defineProperty(messageHandler, 'name', {
          value: `message_handler__decoder_${self._itemId(row)}`,
          writable: false,
        })
        w.worker.addEventListener('message', messageHandler)

        w.status = STATUS.BUSY
        if (window.crossOriginIsolated) {
          // if the app and data are all coming from the same place,
          // then its possible to create a shared array buffer instead of
          // copying data into the worker
          w.worker.postMessage({
            queryIndex: row.queryIndex,
            rowCount: row.rowCount,
            buffer: new SharedArrayBuffer(row.buffer),
          })
        }
        else {
          w.worker.postMessage(row)  
        }
      })
  }
}
