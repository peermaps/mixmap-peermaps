# mixmap-peermaps

peermaps layer for mixmap

# example

``` js
var mixmapPeermaps = require('mixmap-peermaps')
var eyros = require('eyros/2d')
var mixmap = require('mixmap')
var regl = require('regl')
var storage = require('../storage/http')(
  'https://ipfs.io/ipfs/QmVCYUK51Miz4jEjJxCq3bA6dfq5FXD6s2EYp6LjHQhGmh'
)
 
var mix = mixmap(regl, {
  extensions: [ 'oes_element_index_uint', 'oes_texture_float', 'ext_float_blend' ]
})
var map = mix.create({ 
  viewbox: [7.56, 47.55, 7.58, 47.56], // basel, switzerland
  backgroundColor: [0.82, 0.85, 0.99, 1.0],
  pickfb: { colorFormat: 'rgba', colorType: 'float32' }
})

var pm = mixmapPeermaps({
  map,
  eyros,
  storage,
  wasmSource,
  style: (function () {
    var style = new Image
    style.src = 'style.png'
    return style
  })()
})
window.addEventListener('click', function (ev) {
  pm.pick({ x: ev.offsetX, y: ev.offsetY }, function (err, data) {
    console.log('pick', err, data)
  })
})

window.addEventListener('keydown', function (ev) {
  if (ev.code === 'Digit0') {
    map.setZoom(Math.min(6,Math.round(map.getZoom()+1)))
  } else if (ev.code === 'Minus') {
    map.setZoom(map.getZoom()-1)
    console.log(map.getZoom())
  } else if (ev.code === 'Equal') {
    map.setZoom(map.getZoom()+1)
    console.log(map.getZoom())
  }
})
window.addEventListener('resize', function (ev) {
  map.resize(window.innerWidth, window.innerHeight)
})
 
document.body.style.margin = '0px'
document.body.style.overflow = 'hidden'
document.body.appendChild(mix.render())
document.body.appendChild(map.render({ width: window.innerWidth, height: window.innerHeight }))
```

# api

```
var mixmapPeermaps = require('mixmap-peermaps')
```

## mixmapPeermaps(opts)

* `opts.map` - [mixmap][] instance
* `opts.eyros` - `require('eyros/2d')`
* `opts.storage` - [random-access][] storage instance
* `opts.wasmSource` - wasm data of `eyros/2d.wasm` contents as an arraybuffer,
  typed array, [Response][], or Promise resolving to any of those types
* `opts.style` - html img element with [style texture][georender-style2png] image data

[mixmap]: https://github.com/substack/mixmap
[random-access]: https://github.com/random-access-storage
[georender-style2png]: https://github.com/peermaps/georender-style2png
[Response]: https://developer.mozilla.org/en-US/docs/Web/API/Response

# install

npm install mixmap-peermaps

# license

bsd
