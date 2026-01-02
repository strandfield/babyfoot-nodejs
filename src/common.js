
// Common utils

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
    let defaultDataDir = path.join(process.cwd(), 'data');

    let data_dir = defaultDataDir;

    if (process.env.DATA_DIR) {
        data_dir = process.env.DATA_DIR;
    }

    if (data_dir != defaultDataDir) {
        if (!fs.existsSync(data_dir)) {
            console.log(`User-specified custom path "${data_dir}" does not exist`);
            process.exit(1);
        }
    } else {
        if (!fs.existsSync(data_dir)) {
            fs.mkdirSync(data_dir)
        }
    }
    
    return data_dir;
}


let transliterateImpl = null;
import('@sindresorhus/transliterate').then((moduleObject) => {
  transliterateImpl = moduleObject.default;
});

 function transliterate(text) {
    if (!transliterateImpl) {
    return text;
  }
  return transliterateImpl(text);
}

module.exports = {
    resolveDataDir,
    transliterate
};
