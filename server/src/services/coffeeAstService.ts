import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentSymbol, Range, SymbolKind, Position } from 'vscode-languageserver-types';
import { logger } from '../log';

// Parse CoffeeScript AST (via CoffeeScript.compile(..., { ast: true })) and produce LSP DocumentSymbols
export function getDocumentSymbolsFromCoffee(doc: TextDocument): DocumentSymbol[] {
  const text = doc.getText();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Coffee: any = require('coffeescript');
    if (!Coffee || typeof Coffee.compile !== 'function') {
      logger.logDebug && logger.logDebug('coffeescript not found');
      return [];
    }

    const ast = Coffee.compile(text, { ast: true });
    if (!ast) return [];

    const seen = new WeakSet<any>();

    const toRange = (node: any): Range | null => {
      if (!node) return null;

      // Prefer numeric offsets (range or start/end).
      if (Array.isArray(node.range) && typeof node.range[0] === 'number') {
        const start = node.range[0] as number;
        const end = node.range[1] as number;
        return Range.create(doc.positionAt(start), doc.positionAt(end));
      }

      if (typeof node.start === 'number' && typeof node.end === 'number') {
        return Range.create(doc.positionAt(node.start), doc.positionAt(node.end));
      }

      // Babel-like loc: { start: { line, column }, end: { line, column } }
      const loc = node.loc || node.location || node.locationData || node.astLocation || node.rangeData;
      if (loc && loc.start && typeof loc.start.line === 'number') {
        // ASTs often use 1-based line numbers; convert to 0-based for LSP
        const sLine = Math.max(0, (loc.start.line || 0) - 1);
        const sCol = loc.start.column ?? loc.start.column0 ?? 0;
        const eLine = Math.max(0, (loc.end?.line ?? loc.last_line ?? loc.start.line) - 1);
        const eCol = loc.end?.column ?? loc.last_column ?? loc.start.column ?? 0;
        return Range.create(Position.create(sLine, sCol), Position.create(eLine, eCol));
      }

      // Older jison-style locationData: first_line, first_column, last_line, last_column
      if (typeof node.first_line === 'number') {
        // jison typically uses 0-based line numbers for first_line
        const sLine = node.first_line;
        const sCol = node.first_column ?? 0;
        const eLine = node.last_line ?? sLine;
        const eCol = (node.last_column ?? node.first_column ?? 0) + 1;
        return Range.create(Position.create(sLine, sCol), Position.create(eLine, eCol));
      }

      return null;
    };

    const getName = (node: any): string | undefined => {
      if (!node) return undefined;
      if (typeof node.name === 'string' && node.name.trim()) return node.name;
      if (node.name && typeof node.name.value === 'string') return node.name.value;
      if (node.variable && node.variable.base && typeof node.variable.base.value === 'string') return node.variable.base.value;
      if (node.variable && typeof node.variable.name === 'string') return node.variable.name;
      if (node.id && node.id.base && typeof node.id.base.value === 'string') return node.id.base.value;
      if (node.id && typeof node.id === 'string') return node.id;
      if (node.identifier && typeof node.identifier === 'string') return node.identifier;
      if (node.literal && typeof node.literal === 'string') return node.literal;
      if (node.value && typeof node.value === 'string') return node.value;
      if (node.type === 'Class' && node.variable && node.variable.base && node.variable.base.value) return node.variable.base.value;
      return undefined;
    };

    const kindFromNode = (node: any): SymbolKind => {
      const t = (node && (node.type || node.constructor?.name || '')).toString().toLowerCase();
      if (t.includes('class')) return SymbolKind.Class;
      if (t.includes('constructor')) return SymbolKind.Constructor;
      if (t.includes('method')) return SymbolKind.Method;
      if (t.includes('function') || t.includes('code') || t.includes('lambda') || t.includes('func')) return SymbolKind.Function;
      if (t.includes('assign') || t.includes('var') || t.includes('literal') || t.includes('value')) return SymbolKind.Variable;
      if (t.includes('module')) return SymbolKind.Module;
      return SymbolKind.Object;
    };

    function walk(node: any): DocumentSymbol[] {
      if (!node || typeof node !== 'object') return [];
      if (seen.has(node)) return [];
      seen.add(node);

      const childSymbols: DocumentSymbol[] = [];

      for (const key of Object.keys(node)) {
        const val = node[key];
        if (Array.isArray(val)) {
          for (const el of val) {
            childSymbols.push(...walk(el));
          }
        } else if (val && typeof val === 'object') {
          childSymbols.push(...walk(val));
        }
      }

      const name = getName(node);
      const range = toRange(node);
      if (name && range) {
        let selectionRange = range;
        if (node.name) {
          const sel = toRange(node.name);
          if (sel) selectionRange = sel;
        }
        const symbol: DocumentSymbol = {
          name,
          detail: (node.type || '') as string,
          kind: kindFromNode(node),
          range,
          selectionRange,
          children: childSymbols.length ? childSymbols : undefined
        };
        return [symbol];
      }

      return childSymbols;
    }

    const symbols = walk(ast) || [];
    return symbols;
  } catch (e: any) {
    logger.logDebug && logger.logDebug('coffeeAstService failed: ' + (e && e.message));
    return [];
  }
}
