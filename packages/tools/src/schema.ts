import type { JsonSchema } from '@vian/core';

const names = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'description', 'title', 'default']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
type Schema = Record<string, unknown>;

export function assertSchema(schema: unknown, at = '$'): asserts schema is JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${at}: schema must be an object`);
  const s = schema as Schema;
  for (const key of Object.keys(s)) if (!names.has(key)) throw new Error(`${at}: unsupported schema keyword ${key}`);
  if (typeof s.type !== 'string' || !types.has(s.type)) throw new Error(`${at}: type is required`);
  if (s.properties !== undefined) {
    if (s.type !== 'object' || !s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) throw new Error(`${at}: invalid properties`);
    for (const [key, child] of Object.entries(s.properties)) assertSchema(child, `${at}.${key}`);
  }
  if (s.required !== undefined && (s.type !== 'object' || !Array.isArray(s.required) || s.required.some(x => typeof x !== 'string' || !(x in (s.properties as object ?? {}))))) throw new Error(`${at}: invalid required`);
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') throw new Error(`${at}: additionalProperties must be boolean`);
  if (s.items !== undefined) { if (s.type !== 'array') throw new Error(`${at}: items requires array`); assertSchema(s.items, `${at}[]`); }
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) throw new Error(`${at}: invalid enum`);
  if (s.pattern !== undefined) { if (typeof s.pattern !== 'string') throw new Error(`${at}: invalid pattern`); new RegExp(s.pattern); }
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) if (s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key]))) throw new Error(`${at}: invalid ${key}`);
}

export function validateInput(schema: JsonSchema, value: unknown, at = '$'): void {
  const type = schema.type;
  const good = type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (!good) throw new Error(`${at}: expected ${type}`);
  if (schema.enum && !(schema.enum as unknown[]).some(x => Object.is(x, value))) throw new Error(`${at}: value is not allowed`);
  if ('const' in schema && !Object.is(schema.const, value)) throw new Error(`${at}: unexpected value`);
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) throw new Error(`${at}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) throw new Error(`${at}: above maximum`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) throw new Error(`${at}: too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) throw new Error(`${at}: too long`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) throw new Error(`${at}: pattern mismatch`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) throw new Error(`${at}: too few items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) throw new Error(`${at}: too many items`);
    for (const [i, item] of value.entries()) if (schema.items) validateInput(schema.items as JsonSchema, item, `${at}[${i}]`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in value)) throw new Error(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (props[key]) validateInput(props[key], item, `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${at}.${key}: unexpected field`);
    }
  }
}
