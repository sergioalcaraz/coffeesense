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

    const flat: { sym: DocumentSymbol; start: number; end: number }[] = [];
    const seen = new WeakSet<any>();

    const toRange = (node: any): Range | null => {
      if (!node) return null;

      if (Array.isArray(node.range) && typeof node.range[0] === 'number') {
        const start = node.range[0] as number;
        const end = node.range[1] as number;
        return Range.create(doc.positionAt(start), doc.positionAt(end));
      }

      if (typeof node.start === 'number' && typeof node.end === 'number') {
        return Range.create(doc.positionAt(node.start), doc.positionAt(node.end));
      }

      const loc = node.loc || node.location || node.locationData || node.astLocation || node.rangeData;
      if (loc && loc.start && typeof loc.start.line === 'number') {
        const sLine = Math.max(0, (loc.start.line || 0) - 1);
        const sCol = loc.start.column ?? loc.start.column0 ?? 0;
        const eLine = Math.max(0, (loc.end?.line ?? loc.last_line ?? loc.start.line) - 1);
        const eCol = loc.end?.column ?? loc.last_column ?? loc.start.column ?? 0;
        return Range.create(Position.create(sLine, sCol), Position.create(eLine, eCol));
      }

      if (typeof node.first_line === 'number') {
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
      if (node.id && typeof node.id === 'object' && typeof node.id.name === 'string') return node.id.name;
      if (node.key && typeof node.key === 'object' && typeof node.key.name === 'string') return node.key.name;
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

    function collect(node: any) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      // If node has a name and a valid range, create a flat symbol
      const name = getName(node);
      const range = toRange(node);
      if (name && range) {
        const selectionRange = (node.id && toRange(node.id)) || (node.key && toRange(node.key)) || range;
        const sym: DocumentSymbol = {
          name,
          detail: (node.type || '') as string,
          kind: kindFromNode(node),
          range,
          selectionRange,
          children: undefined
        };
        const start = doc.offsetAt(range.start);
        const end = doc.offsetAt(range.end);
        flat.push({ sym, start, end });
      }

      for (const k of Object.keys(node)) {
        const v = node[k];
        if (Array.isArray(v)) {
          for (const el of v) collect(el);
        } else if (v && typeof v === 'object') {
          collect(v);
        }
      }
    }

    collect(ast);

    if (flat.length === 0) return [];

    // Build hierarchy by range containment
    flat.sort((a, b) => a.start - b.start || b.end - a.end);

    const root: DocumentSymbol[] = [];
    const stack: { sym: DocumentSymbol; start: number; end: number }[] = [];

    for (const item of flat) {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (item.start >= top.start && item.end <= top.end) break;
        stack.pop();
      }
      if (stack.length === 0) {
        root.push(item.sym);
      } else {
        const parent = stack[stack.length - 1].sym;
        parent.children = parent.children || [];
        parent.children.push(item.sym);
      }
      stack.push(item);
    }

    return root;
  } catch (e: any) {
    logger.logDebug && logger.logDebug('coffeeAstService failed: ' + (e && e.message));
    return [];
  }
}
