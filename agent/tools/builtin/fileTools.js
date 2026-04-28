import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Read/Write/Edit file tools for the non-SDK agent loop.
 * The SDK loop has built-in Read, Edit, Write tools; these mirror them for the manual route.
 */

export function createReadFileTool() {
  return {
    description: `Read a file from disk and return its contents. Use this to load data files (e.g. variable data, model files) into context after a tool has written them to disk.

Filtering options to avoid reading more than needed:
- startLine / endLine: read a specific line range (1-based, inclusive)
- search: return only lines containing this string (case-insensitive)
- maxLines: cap the number of lines returned (default: no limit)`,
    supportedModes: ['sfd', 'cld'],
    nonSdkOnly: true,
    inputSchema: z.object({
      filePath: z.string().describe('Absolute path to the file to read'),
      startLine: z.number().int().positive().optional().describe('First line to return (1-based, inclusive)'),
      endLine: z.number().int().positive().optional().describe('Last line to return (1-based, inclusive)'),
      search: z.string().optional().describe('Return only lines containing this string (case-insensitive)'),
      maxLines: z.number().int().positive().optional().describe('Maximum number of lines to return')
    }),
    handler: async ({ filePath, startLine, endLine, search, maxLines }) => {
      try {
        if (!existsSync(filePath)) {
          return createErrorResponse(`File not found: ${filePath}`);
        }

        const raw = readFileSync(filePath, 'utf-8');
        let lines = raw.split('\n');
        const totalLines = lines.length;

        if (startLine !== undefined || endLine !== undefined) {
          const start = (startLine ?? 1) - 1;
          const end = endLine ?? totalLines;
          lines = lines.slice(start, end);
        }

        if (search) {
          const lower = search.toLowerCase();
          lines = lines.filter(l => l.toLowerCase().includes(lower));
        }

        if (maxLines !== undefined) {
          lines = lines.slice(0, maxLines);
        }

        return createSuccessResponse({
          filePath,
          totalLines,
          returnedLines: lines.length,
          content: lines.join('\n')
        });
      } catch (error) {
        return createErrorResponse(`Failed to read file: ${error.message}`, error);
      }
    }
  };
}

export function createWriteFileTool() {
  return {
    description: 'Write content to a file on disk, creating the file (and any parent directories) if it does not exist. Overwrites any existing content.',
    supportedModes: ['sfd', 'cld'],
    nonSdkOnly: true,
    inputSchema: z.object({
      filePath: z.string().describe('Absolute path to the file to write'),
      content: z.string().describe('Content to write to the file')
    }),
    handler: async ({ filePath, content }) => {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
        return createSuccessResponse({ filePath, bytesWritten: Buffer.byteLength(content, 'utf-8') });
      } catch (error) {
        return createErrorResponse(`Failed to write file: ${error.message}`, error);
      }
    }
  };
}

export function createEditFileTool() {
  return {
    description: `Replace a string in a file with new content.

By default, old_string must appear exactly once. Set replaceAll: true to replace every occurrence.
The match is exact (whitespace-sensitive). Provide enough surrounding context to make the match unique.`,
    supportedModes: ['sfd', 'cld'],
    nonSdkOnly: true,
    inputSchema: z.object({
      filePath: z.string().describe('Absolute path to the file to edit'),
      oldString: z.string().describe('The exact string to find and replace'),
      newString: z.string().describe('The string to replace it with'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring exactly one (default: false)')
    }),
    handler: async ({ filePath, oldString, newString, replaceAll = false }) => {
      try {
        if (!existsSync(filePath)) {
          return createErrorResponse(`File not found: ${filePath}`);
        }
        const content = readFileSync(filePath, 'utf-8');
        const count = content.split(oldString).length - 1;

        if (count === 0) {
          return createErrorResponse(`old_string not found in file: ${filePath}`);
        }
        if (!replaceAll && count > 1) {
          return createErrorResponse(`old_string matches ${count} locations — add more context to make it unique, or set replaceAll: true`);
        }

        const updated = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);

        writeFileSync(filePath, updated, 'utf-8');
        return createSuccessResponse({ filePath, replacements: count });
      } catch (error) {
        return createErrorResponse(`Failed to edit file: ${error.message}`, error);
      }
    }
  };
}
