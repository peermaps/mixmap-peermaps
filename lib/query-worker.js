// query-worker
var bboxIntersect = require('bbox-intersect')
var storageHooks = require('./storage-hooks.js')

module.exports = function (self) {
  // config
  var eyrosConfig, storageConfig, storageOptions, wasmSourceUrl
  // initialized
  var eyros, storage, _db

  var queryQueue = []
  var _dbQueue = []
  var _trace = {}
  var _loading = new Set

  function config () {
    if (!(eyrosConfig && storageConfig && storageOptions && wasmSourceUrl)) return
    storage = storageHooks(self.storage(storageConfig.moduleId)(storageOptions), {
      beforeLength: function (name) {
        _loading.add(name)
      },
      afterLength: function (name) {
        _loading.delete(name)
      },
      beforeRead: function (name) {
        _loading.add(name)
      },
      afterRead: function (name) {
        _loading.delete(name)
      },
    })
    _db = null
    eyros({ storage, wasmSource: fetch(wasmSourceUrl) })
        .then(db => {
          _db = db
          self.postMessage({ type: 'ready' })
          for (var i = 0; i < _dbQueue.length; i++) {
            _dbQueue[i](db)
          }
        })
        .catch(e => console.log(e))
  }

  function getDb (cb) {
    if (_db) return cb(_db)
    else _dbQueue.push(cb)
  }

  function trace (tr) {
    _trace[tr.file] = tr
  }

  self.onmessage = function (e) {
    var {type} = e.data
    if (type === 'init:bundles') {
      wasmSourceUrl = e.data.wasmSourceUrl
      eyrosConfig = e.data.eyros
      importScripts(eyrosConfig.url)
      eyros = self.eyros(eyrosConfig.moduleId)
      // eyros = self.require('eyros')
      storageConfig = e.data.storage
      importScripts(storageConfig.url)
      if (e.data.storageOptions) {
        storageOptions = e.data.storageOptions 
        config()
      }
    }
    if (type === 'init:setStorageOptions') {
      if (e.data.storage) {
        storageConfig = e.data.storage
        importScripts(storageConfig.url)  
      }
      if (e.data.storageOptions) {
        storageOptions = e.data.storageOptions  
      }
      config()
    }
    if (type === 'query:init') {
      var {bbox, queryIndex} = e.data
      queryQueue[queryIndex] = true
      getDb(function (db) {
        var rowCount = -1
        db.query(bbox, { trace }).then(async (q) => {
          if (!queryQueue[queryIndex]) return
          var result
          while(result = await q.next()) {
            if (!queryQueue[queryIndex]) break
            ++rowCount
            postMessage({ type: 'query:result', result, queryIndex, rowCount })
          }
          queryQueue[queryIndex] = null
          postMessage({ type: 'query:done' })
        })
      })
    }
    if (type === 'query:cancel') {
      var {queryIndex, currentMapViewbox} = e.data
      queryQueue[queryIndex] = null
      for (var file of _loading) {
        var tr = _trace[file]
        if (!tr) continue
        if (!bboxIntersect(currentMapViewbox, tr.bbox)) {
          self._storage.destroy(file)
        }
      }
    }
  }
}
