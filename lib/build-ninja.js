'use babel';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import voucher from 'voucher';
import { EventEmitter } from 'events';

export const config = {
  subdirs: {
    title: 'Build directories',
    description: 'List of project subdirectories to search for build.ninja file',
    type: 'array',
    default: ['src/out/Debug'],
    items: { type: 'string' },
    order: 1
  }
};

export function provideBuilder() {
  const gccErrorMatch = '(?<file>([A-Za-z]:[\\/])?[^:\\n]+):(?<line>\\d+):(?<col>\\d+):\\s*(fatal error|error|warning):\\s*(?<message>.+)';
  const errorMatch = [ gccErrorMatch ];

  return class NinjaBuildProvider extends EventEmitter {
    constructor(cwd) {
      super();
      this.cwd = cwd;
      atom.config.observe('build-make.subdirs', () => this.emit('refresh'));
    }

    getNiceName() {
      return 'Ninja';
    }

    isEligible() {
      this.dirs = atom.config.get('build-ninja.subdirs')
        .filter(d => fs.existsSync(path.join(this.cwd, d, 'build.ninja')));
      return this.dirs.length > 0;
    }

    settings() {
      console.log('settings');
      const addDirPrefix = this.dirs.length > 1;

      const promises = this.dirs.map(dir => {
        const buildDir = path.join(this.cwd, dir);
        const args = ['-C', buildDir, '-t', 'targets'];
        return voucher(execFile, 'ninja', args, { cwd: this.cwd }).then(output => {
          let targets = extractTargetNames(output);
          return targets.map(name => createTargetConfig(this.cwd, dir, name, addDirPrefix));
        });
      });
      return Promise.all(promises).then(lists => [].concat(...lists));
    }
  };
}

function extractTargetNames(output) {
  const lines = output.split(/\n/);
  let targets = [];
  for (line of lines) {
    const m = /^([\w\d_]+): \w+$/.exec(line);
    if (m != null)
      targets.push(m[1]);
  }
  return targets;
}

function createTargetConfig(projectDir, dir, targetName, addDirPrefix) {
  if (addDirPrefix)
    targetName = dir + ': ' + targetName;
  const buildDir = path.join(projectDir, dir);

  return {
    exec: 'ninja',
    args: [targetName],
    cwd: buildDir,
    name: 'Ninja: ' + targetName,
    sh: false,
  };
}
