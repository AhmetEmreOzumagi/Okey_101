
  // Kotlin tarafı Host.call(json) ile konuşur (bkz. host-core.js)
  var kok = typeof window !== 'undefined' ? window : globalThis;
  kok.Host = require('host-core.js');
})();
