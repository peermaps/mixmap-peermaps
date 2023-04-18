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
    eyros = self.eyros(eyrosConfig.moduleId)
    storage = storageHooks(self.storage(storageConfig.moduleId)(storageOptions, {debug:true}), {
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

  function destroy (file) {
    if (!(storage && storage.destroy)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      storage.destroy(file, function () {
        resolve()
      })
    })
  }

  self.onmessage = async function (e) {
    var {type} = e.data
    if (type === 'init:bundles') {
      wasmSourceUrl = e.data.wasmSourceUrl
      eyrosConfig = e.data.eyros
      importScripts(eyrosConfig.url)
      // eyros = self.require('eyros')
      storageConfig = e.data.storage
      importScripts(storageConfig.url)
      if (e.data.storageOptions) {
        storageOptions = e.data.storageOptions 
        config()
      }
    }
    if (type === 'terminate') {
      var destroyers = []
      for (var file in _loading) {
        var tr = _trace[file]
        if (!tr) continue
        destroyers.push(destroy(file))
      }
      await Promise.all(destroyers)
      postMessage({ type: 'terminated' })
    }
    if (type === 'query:init') {
      var {bbox, queryIndex} = e.data
      queryQueue[queryIndex] = true
      getDb(function (db) {
        var rowCount = -1
        db.query(bbox, { trace }).then(async (q) => {
          if (!queryQueue[queryIndex]) return
          var result
          try { 
            while(result = await q.next()) {
              if (!queryQueue[queryIndex]) break
              ++rowCount
              postMessage({ type: 'query:result', result, queryIndex, rowCount })
            } 
          }
          catch (error) {
            console.log('query error', error)
          }
          finally {
            queryQueue[queryIndex] = null
            postMessage({ type: 'query:done', queryIndex })
          }
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
          storage.destroy(file)
        }
      }
    }
  }
}
