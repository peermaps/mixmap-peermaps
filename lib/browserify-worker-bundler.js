var browserifyBundleFn = arguments[3];
var browserifySources = arguments[4];
var browserifyCache = arguments[5];

function findModuleId (moduleFn) {
  for (var id in browserifyCache) {
    if (browserifyCache[id].exports === moduleFn) {
      return id;
    }
  }
  throw new Error('Module not found in Browserify bundle.');
}

function createBundleUrl (moduleId, name) {
  console.log('createBundleUrl', moduleId, name)
  var addedSources = {};
  resolveSources({}, addedSources, moduleId);

  var deps = Object.keys(addedSources);
  if (!deps.length) return;

  var src = generateWorkerBundle(deps, name);
  console.log({src})
  var url = createURL(src);
  return {
    moduleId,
    url,
  }
}


function resolveSources(workerSources, addedSources, key) {
  if (workerSources[key]) return;

  workerSources[key] = true;
  addedSources[key] = true;

  var deps = browserifySources[key][1];
  for (var depPath in deps) {
    resolveSources(workerSources, addedSources, deps[depPath]);
  }
}

function generateWorkerBundle(deps, name) {
  return 'self.'+ name +'=(' + browserifyBundleFn + ')({' + deps.map(function (key) {
    var source = browserifySources[key];
    return JSON.stringify(key) + ':[' + source[0] + ',' + JSON.stringify(source[1]) + ']';
  }).join(',') + '},{},[])';
}

function createURL(src) {
    var URL = window.URL || window.webkitURL;
    var blob = new Blob([src], {type: 'text/javascript'});
    return URL.createObjectURL(blob);
}

function workerBundle (moduleFn, name) {
  return createBundleUrl(findModuleId(moduleFn), name)
}

module.exports = workerBundle