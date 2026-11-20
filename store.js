'use strict';
// JSON 持久化：userData 目录下的原子写入，读取时逐条校验。
const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.data = this.read();
  }

  read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return raw ?? this.fallback;
    } catch {
      return this.fallback;
    }
  }

  write(data) {
    this.data = data;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file); // 同目录原子替换
    } catch (err) {
      console.error('写入数据失败:', err.message);
    }
  }

  update(mutator) {
    const next = typeof mutator === 'function' ? mutator(this.data) : mutator;
    this.write(next);
    return this.data;
  }
}

module.exports = { JsonStore };
