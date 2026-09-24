/**
 * document-service.js
 * Handles file writing and Pandoc execution for document export.
 * Uses spawn only (no exec). Promise-based. Returns absolute output path.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Write markdown content to a temp file.
 * @param {string} content - Markdown string
 * @returns {Promise<string>} Absolute path to temp .md file
 */
export async function writeTempFile(content) {
  const tmpDir = os.tmpdir();
  const fileName = `research-doc-${Date.now()}.md`;
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Run a pandoc conversion via spawn.
 * @param {string[]} args - pandoc CLI args
 * @returns {Promise<void>}
 */
function runPandoc(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pandoc', args, { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start pandoc: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pandoc exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Check if a CLI binary is installed and executable in PATH.
 * @param {string} cmd - Command name
 * @param {string[]} args - Verification args
 * @returns {Promise<boolean>}
 */
function checkBinary(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Convert markdown file → .tex via pandoc --standalone
 * @param {string} inputPath - Absolute path to .md file
 * @param {string} outputPath - Absolute path for output .tex
 * @returns {Promise<string>} outputPath
 */
export async function convertToTex(inputPath, outputPath) {
  const hasPandoc = await checkBinary('pandoc');
  if (!hasPandoc) {
    throw new Error('Pandoc is not installed or not in system PATH. Please install Pandoc to export documents.');
  }
  await runPandoc([inputPath, '-o', outputPath, '--standalone']);
  return outputPath;
}

/**
 * Convert markdown file → .pdf via pandoc + pdflatex
 * @param {string} inputPath - Absolute path to .md file
 * @param {string} outputPath - Absolute path for output .pdf
 * @returns {Promise<string>} outputPath
 */
export async function convertToPdf(inputPath, outputPath) {
  const hasPandoc = await checkBinary('pandoc');
  if (!hasPandoc) {
    throw new Error('Pandoc is not installed or not in system PATH. Please install Pandoc to export documents.');
  }
  const hasPdflatex = await checkBinary('pdflatex', ['-version']);
  if (!hasPdflatex) {
    throw new Error('pdflatex is not installed or not in system PATH. Please install a LaTeX engine (MiKTeX or TeX Live) to export PDF.');
  }
  await runPandoc([inputPath, '-o', outputPath, '--pdf-engine=pdflatex']);
  return outputPath;
}
